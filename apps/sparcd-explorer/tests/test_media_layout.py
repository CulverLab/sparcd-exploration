import unittest

from notebook_cells import BUCKET, PREFIX, FakeS3, deployment, hex_of, media, observation, render_images, run_explorer

TS = "2021-05-31T08:25:38"
KEY = f"Media/{'a' * 64}/20210531082538-RCNX0031.JPG"


def upload(s3, name, bucket=BUCKET, uuid="test", key=None, species="Owl", marker=True):
    image = media(name, "owl.jpg", "AAA01", TS)
    obs = observation(name, "owl.jpg", "AAA01", TS, common=species, scientific=species)
    if key:
        image[0] = obs[3] = key
    return s3.upload(name, bucket=bucket, uuid=uuid, marker=marker,
                     deployments=[deployment("AAA01", "Alpha", 32, -110)],
                     media=[image], observations=[obs])


class MediaLayoutTest(unittest.TestCase):
    def test_data_and_legacy_images_load_count_and_presign(self):
        for bucket, key in (("field-data", KEY), (BUCKET, PREFIX + "u1/owl.jpg")):
            with self.subTest(bucket=bucket):
                s3 = upload(FakeS3(), "u1", bucket=bucket, key=key)
                ns, scopes = run_explorer(s3, click=hex_of("Alpha"))
                self.assertEqual(scopes["stat_row"]["_images"], 1)
                self.assertEqual(ns["media"]["bucket"].to_list(), [bucket])
                render_images(ns)
                self.assertEqual(s3.presigns, [(bucket, key)])

    def test_split_collection_prefers_data_copy(self):
        s3 = upload(FakeS3(), "copied", key=KEY)
        upload(s3, "old")
        upload(s3, "copied", bucket="field-data", key=KEY)
        upload(s3, "new", bucket="field-data", key=KEY)
        ns, scopes = run_explorer(s3, click=hex_of("Alpha"))
        self.assertEqual(ns["collections_registry"][0]["buckets"], ["field-data", BUCKET])
        self.assertEqual(scopes["deployments"]["total_uploads"], 3)
        self.assertEqual(ns["media"].height, 3)
        self.assertNotIn((BUCKET, PREFIX + "copied/media.csv"), s3.reads)
        self.assertEqual(ns["media"].filter(ns["pl"].col("upload") == PREFIX + "copied/")["bucket"].to_list(), ["field-data"])

    def test_half_copied_data_folder_does_not_hide_the_legacy_upload(self):
        s3 = upload(FakeS3(), "copying")
        s3.upload("copying", bucket="field-data", deployments=[deployment("AAA01", "Alpha", 32, -110)], media=None)
        ns, scopes = run_explorer(s3)
        self.assertEqual(scopes["deployments"]["total_uploads"], 1)
        self.assertEqual(ns["media"]["bucket"].to_list(), [BUCKET])

    def test_shared_key_keeps_upload_observations_separate(self):
        s3 = upload(FakeS3(), "u1", bucket="field-data", key=KEY)
        upload(s3, "u2", bucket="field-data", key=KEY, species="Deer")
        ns, scopes = run_explorer(s3, click=hex_of("Alpha"))
        self.assertEqual(ns["locations"]["image_count"].to_list(), [2])
        self.assertEqual(ns["locations"]["tagged_image_count"].to_list(), [2])
        self.assertEqual(ns["hex_summary"]["checklists"].to_list(), [2])
        self.assertEqual((scopes["location_summary_card"]["_total"], scopes["location_summary_card"]["_tagged"]), (2, 2))
        self.assertEqual(ns["selected_total"], 2)
        self.assertEqual(set(ns["selected_images_all"]["scientific_name"]), {"Owl", "Deer"})
        self.assertEqual(ns["selected_images_all"]["count"].to_list(), [1, 1])
        ns, _ = run_explorer(s3, search={"include_common": ["Owl"]}, click=hex_of("Alpha"))
        self.assertEqual(ns["media_filtered"]["upload"].to_list(), [PREFIX + "u1/"])
        self.assertEqual(ns["selected_total"], 1)

    def test_registry_merges_markers_and_skips_reserved_and_unreadable_buckets(self):
        s3 = FakeS3().collection("z-data", name="Z name").collection("a-data", name="A name", org="Lab")
        s3.collection(BUCKET, name="Legacy name")
        upload(s3, "u1", bucket="field-data", uuid="other", marker=False)
        s3.collection("sparcd-OTHER", "other", "Other")
        upload(s3, "u1", bucket="field-data", uuid="orphan", marker=False)
        s3.collection("sparcd", name="Reserved")
        s3.files["sparcd-settings-x", "settings.json"] = b"{}"
        s3.collection("blocked", name="Blocked")
        s3.list_errors.add("blocked")
        s3.upload("u1", bucket="sparcd-orphan", uuid="orphan", marker=False)
        ns, _ = run_explorer(s3)
        found = {c["uuid"]: c for c in ns["collections_registry"]}
        self.assertEqual(set(found), {"test", "other"})
        self.assertEqual(found["test"], dict(name="A name", org="Lab", uuid="test", bucket="a-data", buckets=["a-data", "z-data", BUCKET]))
        self.assertEqual(found["other"]["bucket"], "sparcd-OTHER")
        self.assertEqual(found["other"]["buckets"], ["field-data", "sparcd-OTHER"])
        self.assertFalse(any(b in {"sparcd", "sparcd-settings-x"} for b, p, r in s3.listings))

    def test_two_collections_in_one_bucket_have_distinct_cache_entries(self):
        s3 = upload(FakeS3(), "u1", bucket="field-data", key=KEY)
        s3.collection("field-data", "other", "Other")
        upload(s3, "u2", bucket="field-data", uuid="other", key=KEY, species="Deer")
        cache = {}
        first, _ = run_explorer(s3, chosen=["test"], cache=cache)
        second, _ = run_explorer(s3, chosen=["other"], cache=cache)
        self.assertEqual(first["observations"]["scientific_name"].to_list(), ["Owl"])
        self.assertEqual(second["observations"]["scientific_name"].to_list(), ["Deer"])
        self.assertEqual(len(cache), 2)

    def test_missing_media_is_silent_but_other_failures_are_reported(self):
        s3 = upload(FakeS3(), "ready")
        s3.upload("pending", deployments=[deployment("AAA01", "Alpha", 32, -110)], media=None)
        _, scopes = run_explorer(s3)
        self.assertEqual(scopes["deployments"]["total_uploads"], 1)
        self.assertEqual(scopes["deployments"]["_cached"]["skipped"], {})
        self.assertIsNone(scopes["deployments"]["_load_note"])
        del s3.files[BUCKET, PREFIX + "ready/observations.csv"]
        _, scopes = run_explorer(s3)
        self.assertIn("observations.csv", scopes["deployments"]["_cached"]["skipped"][PREFIX + "ready"][0])
