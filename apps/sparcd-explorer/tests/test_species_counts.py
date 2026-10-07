import unittest

from notebook_cells import FakeS3, deployment, hex_of, media, observation, run_explorer


def collection():
    return (
        FakeS3()
        .upload(
            "u1",
            deployments=[deployment("AAA01", "Alpha", 32.0, -110.0)],
            media=[media("u1", "owl.jpg", "AAA01", "2024-01-01T10:00:00")],
            observations=[observation("u1", "owl.jpg", "AAA01", "2024-01-01T10:00:00", common="Owl", scientific="Strigiformes")],
        )
        .upload(
            "u2",
            deployments=[deployment("BBB01", "Bravo", 33.0, -111.0)],
            media=[media("u2", "deer.jpg", "BBB01", "2024-01-02T10:00:00")],
            # A common name with no scientific name.
            observations=[observation("u2", "deer.jpg", "BBB01", "2024-01-02T10:00:00", common="Deer")],
        )
        .upload(
            "u3",
            # Location 0000 stays off the map and out of the table.
            deployments=[deployment("0000", "Unknown", 31.0, -109.0)],
            media=[media("u3", "pig.jpg", "0000", "2024-01-03T10:00:00")],
            observations=[observation("u3", "pig.jpg", "0000", "2024-01-03T10:00:00", common="Javelina", scientific="Pecari tajacu")],
        )
    )


class SpeciesCountsTest(unittest.TestCase):
    def test_stat_card_matches_map_panel(self):
        _, scopes = run_explorer(collection())

        self.assertEqual(scopes["stat_row"]["_species"], {"Owl", "Deer"})
        self.assertEqual(len(scopes["map_dashboard"]["_species"]), 2)

    def test_hex_panel_and_card_agree_for_a_clicked_hex(self):
        ns, scopes = run_explorer(collection(), click=hex_of("Bravo"))

        richness = next(r["species_richness"] for r in ns["hex_summary"].iter_rows(named=True) if "Bravo" in r["location_names"])
        self.assertEqual(richness, 1)
        self.assertEqual(len(scopes["map_dashboard"]["_species"]), 1)
        self.assertEqual(scopes["location_summary_card"]["_distinct_species"], 1)


if __name__ == "__main__":
    unittest.main()
