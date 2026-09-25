import unittest

from notebook_cells import FakeS3, deployment, media, run_explorer


def collection(alpha=(31.5, -110.0), delta=(32.2, -110.8), extra_charlie_uploads=0):
    s3 = FakeS3()
    for upload, site, name, (lat, lng) in (
        ("u1", "AAA01", "Alpha", alpha),
        ("u2", "BBB01", "Bravo", (32.0, -110.5)),
        ("u3", "CCC01", "Charlie", (33.5, -111.0)),
        ("u4", "DDD01", "Delta", delta),
    ):
        s3.upload(upload, deployments=[deployment(site, name, lat, lng)], media=[media(upload, "a.jpg", site, "2024-01-01T10:00:00")])
    for i in range(extra_charlie_uploads):
        s3.upload(f"x{i}", deployments=[deployment("CCC01", "Charlie", 33.5, -111.0)], media=[media(f"x{i}", "a.jpg", "CCC01", "2024-01-01T10:00:00")])
    return s3


def hex_ids(ns):
    return {name: r["h3_id"] for r in ns["hex_summary"].iter_rows(named=True) for name in r["location_names"]}


class HexGridTest(unittest.TestCase):
    def test_a_search_does_not_move_a_sites_hex(self):
        everything, _ = run_explorer(collection())
        alpha_only, _ = run_explorer(collection(), search={"site_code": ["AAA01"]})

        self.assertEqual(alpha_only["hex_summary"].height, 1)
        self.assertEqual(hex_ids(alpha_only)["Alpha"], hex_ids(everything)["Alpha"])

    def test_map_centre_comes_from_the_hex_not_the_site(self):
        centres = []
        for alpha in ((31.5, -110.0), (31.5, -110.0005)):
            ns, scopes = run_explorer(collection(alpha=alpha), search={"site_code": ["AAA01"]})
            centre = scopes["camera_map"]["camera_fig"].layout.map.center
            centres.append((hex_ids(ns)["Alpha"], round(centre.lat, 9), round(centre.lon, 9)))

        # Moving the only site east inside its hex leaves the map centre where it was.
        self.assertEqual(centres[0], centres[1])

    def test_extra_uploads_at_one_site_do_not_move_the_grid(self):
        once, _ = run_explorer(collection())
        many, _ = run_explorer(collection(extra_charlie_uploads=4))

        self.assertEqual(hex_ids(many), hex_ids(once))

    def test_swapped_coordinates_anchor_like_corrected_ones(self):
        corrected, _ = run_explorer(collection())
        swapped, _ = run_explorer(collection(delta=(-110.8, 32.2)))

        self.assertEqual(hex_ids(swapped), hex_ids(corrected))


if __name__ == "__main__":
    unittest.main()
