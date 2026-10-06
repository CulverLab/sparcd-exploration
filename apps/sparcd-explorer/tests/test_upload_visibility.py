import ast
import unittest
from pathlib import Path


def load_visibility_helpers(notebook: str):
    module = ast.parse((Path(__file__).parents[1] / "notebooks" / notebook).read_text())
    for cell in ast.walk(module):
        if not isinstance(cell, ast.FunctionDef) or cell.name != "_":
            continue
        helpers = [
            statement
            for statement in cell.body
            if isinstance(statement, ast.FunctionDef)
            and statement.name in {"_upload_is_visible", "_load_visible_upload_rows"}
        ]
        if len(helpers) == 2:
            for helper in helpers:
                ast.fix_missing_locations(helper)
            namespace = {}
            exec(compile(ast.Module(body=helpers, type_ignores=[]), notebook, "exec"), namespace)
            return namespace["_upload_is_visible"], namespace["_load_visible_upload_rows"]
    raise AssertionError(f"visibility helpers were not found in {notebook}")


class FakeObject:
    def read(self):
        return b"{}"


class NoSuchKey(Exception):
    code = "NoSuchKey"


class FakeClient:
    def __init__(self, objects, failing=()):
        self.objects = objects
        self.failing = set(failing)

    def get_object(self, bucket, key):
        if key in self.failing:
            raise ConnectionError(key)
        if key not in self.objects:
            raise NoSuchKey(key)
        return FakeObject()


def read_csv(client, bucket, key):
    if key not in client.objects:
        raise NoSuchKey(key)
    return [[key]]


class UploadVisibilityTest(unittest.TestCase):
    def test_both_notebooks_loader_excludes_unmarked_upload_rows_and_counts(self):
        for notebook in ("hello.py", "hello_wasm.py"):
            visible_helper, loader = load_visibility_helpers(notebook)
            globals_for_helpers = visible_helper.__globals__
            client = FakeClient(
                {
                    "published/UploadMeta.json",
                    "published/deployments.csv",
                    "published/media.csv",
                    "published/observations.csv",
                },
                failing={"unreadable/UploadMeta.json"},
            )
            skipped = []
            globals_for_helpers["_skip"] = lambda where, what, exc: skipped.append((where, what))
            globals_for_helpers["client"] = client
            globals_for_helpers["_upload_is_visible"] = visible_helper
            globals_for_helpers["_read_csv"] = lambda bucket, key: read_csv(client, bucket, key)

            self.assertTrue(visible_helper("bucket", "published/"), notebook)
            self.assertFalse(visible_helper("bucket", "interrupted/"), notebook)
            skipped.clear()
            rows = loader("bucket", ["published/", "interrupted/", "unreadable/"])
            self.assertEqual(rows[-1], 1, notebook)
            self.assertEqual(skipped, [("unreadable", "UploadMeta.json")], notebook)
            self.assertEqual(rows[0], [["published/deployments.csv"]], notebook)
            self.assertEqual(rows[2], [["published/media.csv"]], notebook)
            self.assertEqual(rows[4], [["published/observations.csv"]], notebook)


if __name__ == "__main__":
    unittest.main()
