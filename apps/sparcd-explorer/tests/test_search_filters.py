import unittest
from datetime import date

from notebook_cells import FakeS3, deployment, media, observation, run_explorer


def collection():
    return (
        FakeS3()
        .upload(
            "u1",
            deployments=[deployment("AAA01", "Alpha", 32.0, -110.0)],
            media=[
                media("u1", "june.jpg", "AAA01", "2018-06-15T10:00:00"),
                media("u1", "july.jpg", "AAA01", "2018-07-15T10:00:00"),
                media("u1", "no-rows.jpg", "AAA01", "2018-06-20T10:00:00"),
                media("u1", "placeholder.jpg", "AAA01", "2018-06-21T10:00:00"),
            ],
            observations=[
                observation("u1", "june.jpg", "AAA01", "2018-06-15T10:00:00", common="Owl"),
                observation("u1", "july.jpg", "AAA01", "2018-07-15T10:00:00", common="Owl"),
                observation("u1", "placeholder.jpg", "AAA01", "2018-06-21T10:00:00", kind="blank"),
            ],
        )
        .upload(
            "u2",
            deployments=[deployment("BBB01", "Bravo", 33.0, -111.0)],
            media=[media("u2", "later.jpg", "BBB01", "2024-12-01T10:00:00")],
        )
    )


def sites_and_images(search):
    _, scopes = run_explorer(collection(), search=search)
    return scopes["stat_row"]["_sites"], scopes["stat_row"]["_images"]


class SearchFiltersTest(unittest.TestCase):
    def test_default_view_keeps_every_image(self):
        self.assertEqual(sites_and_images(None), (2, 5))

    def test_date_range_applies_to_every_image(self):
        june = {"start_date": date(2018, 6, 1), "end_date": date(2018, 6, 30)}
        # june.jpg by its observation, no-rows.jpg by its media timestamp, placeholder.jpg by its row.
        self.assertEqual(sites_and_images(june), (1, 3))

    def test_year_dates_images_without_rows_by_media_timestamp(self):
        self.assertEqual(sites_and_images({"year": ["2024"]}), (1, 1))

    def test_include_filter_leaves_untagged_images_out(self):
        self.assertEqual(sites_and_images({"include_common": ["Owl"]}), (1, 2))


if __name__ == "__main__":
    unittest.main()
