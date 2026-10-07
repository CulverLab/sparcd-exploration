import unittest

from notebook_cells import FakeS3, deployment, hex_of, media, observation, run_explorer

TS = "2024-01-01T10:00:00"


def collection():
    return FakeS3().upload(
        "u1",
        deployments=[deployment("AAA01", "Alpha", 32.0, -110.0)],
        media=[media("u1", f"{name}.jpg", "AAA01", TS) for name in ("owl", "blank", "empty")],
        observations=[
            observation("u1", "owl.jpg", "AAA01", TS, common="Owl", scientific="Strigiformes"),
            # The uploader's placeholder is typed blank; sparcd-web leaves the type empty.
            observation("u1", "blank.jpg", "AAA01", TS, kind="blank"),
            observation("u1", "empty.jpg", "AAA01", TS),
        ],
    )


class PlaceholderRowsTest(unittest.TestCase):
    def test_placeholder_rows_count_as_untagged(self):
        ns, scopes = run_explorer(collection(), click=hex_of("Alpha"))

        site = ns["locations"].row(0, named=True)
        self.assertEqual((site["image_count"], site["tagged_image_count"]), (3, 1))
        self.assertEqual((scopes["stat_row"]["_images"], scopes["stat_row"]["_tagged"]), (3, 1))
        card = scopes["location_summary_card"]
        self.assertEqual((card["_total"], card["_tagged"], card["_untagged"]), (3, 1, 2))

    def test_tagged_only_grid_leaves_placeholders_out(self):
        ns, _ = run_explorer(collection(), click=hex_of("Alpha"))

        self.assertEqual([p.rsplit("/", 1)[-1] for p in ns["selected_images_all"]["media_path"]], ["owl.jpg"])


if __name__ == "__main__":
    unittest.main()
