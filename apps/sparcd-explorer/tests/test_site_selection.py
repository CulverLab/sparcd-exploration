import unittest

from notebook_cells import FakeS3, deployment, hex_of, media, observation, point_of, run_explorer

TS = "2024-01-01T10:00:00"


def site_upload(s3, upload, name, lat, files):
    return s3.upload(
        upload,
        deployments=[deployment("SAN19", name, lat, -110.0)],
        media=[media(upload, f, "SAN19", TS) for f in files],
        observations=[observation(upload, f, "SAN19", TS, common="Owl", scientific="Strigiformes") for f in files],
    )


def collection():
    # Two sites share the id SAN19, as some locations.json entries do.
    s3 = site_upload(FakeS3(), "u1", "Mansfield-3", 32.0, ["n1.jpg", "n2.jpg", "n3.jpg"])
    return site_upload(s3, "u2", "Mansfield-3 old", 32.6, ["o1.jpg", "o2.jpg"])


def file_names(ns):
    return sorted(p.rsplit("/", 1)[-1] for p in ns["selected_images_all"]["media_path"])


class SameIdSitesTest(unittest.TestCase):
    def test_clicking_a_hex_shows_only_its_site(self):
        ns, scopes = run_explorer(collection(), click=hex_of("Mansfield-3 old"))

        self.assertEqual(scopes["location_summary_card"]["_total"], 2)
        self.assertEqual(scopes["selection_report"]["_img"], 2)
        self.assertEqual(file_names(ns), ["o1.jpg", "o2.jpg"])

    def test_clicking_a_point_shows_only_its_site(self):
        ns, scopes = run_explorer(collection(), click=point_of("Mansfield-3"), points=True)

        self.assertEqual(scopes["location_summary_card"]["_total"], 3)
        self.assertEqual(file_names(ns), ["n1.jpg", "n2.jpg", "n3.jpg"])

    def test_hex_counts_stay_with_their_own_site(self):
        ns, _ = run_explorer(collection())

        counts = {r["location_names"][0]: r["checklists"] for r in ns["hex_summary"].iter_rows(named=True)}
        self.assertEqual(counts, {"Mansfield-3": 3, "Mansfield-3 old": 2})


if __name__ == "__main__":
    unittest.main()
