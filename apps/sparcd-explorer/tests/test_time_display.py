import ast
import unittest
from pathlib import Path


def load_helpers(notebook: Path):
    module = ast.parse(notebook.read_text())
    helpers = []
    for cell in ast.walk(module):
        if not isinstance(cell, ast.FunctionDef) or cell.name != "_":
            continue
        for statement in cell.body:
            if isinstance(statement, ast.FunctionDef) and statement.name == "format_timestamp_24":
                ast.fix_missing_locations(statement)
                namespace = {}
                exec(compile(ast.Module(body=[statement], type_ignores=[]), str(notebook), "exec"), namespace)
                helpers.append(namespace["format_timestamp_24"])
    if not helpers:
        raise AssertionError(f"format_timestamp_24 was not found in {notebook}")
    return helpers


class TimeDisplayTest(unittest.TestCase):
    def test_both_notebooks_render_late_hours_without_ampm(self):
        root = Path(__file__).parents[1] / "notebooks"
        for notebook in (root / "hello.py", root / "hello_wasm.py"):
            for format_timestamp_24 in load_helpers(notebook):
                rendered = format_timestamp_24("2026-09-11T22:15:10.000Z")
                self.assertEqual(rendered, "2026-09-11 22:15:10")
                self.assertNotRegex(rendered, r"AM|PM")

    def test_missing_timestamp_is_empty(self):
        helper = load_helpers(Path(__file__).parents[1] / "notebooks" / "hello.py")[0]
        self.assertEqual(helper(None), "")

    def test_detection_tables_convert_timestamp_values_in_both_notebooks(self):
        root = Path(__file__).parents[1] / "notebooks"
        conversion = 'pl.col("Timestamp").map_elements(format_timestamp_24, return_dtype=pl.Utf8)'
        for notebook in (root / "hello.py", root / "hello_wasm.py"):
            self.assertIn(conversion, notebook.read_text())
