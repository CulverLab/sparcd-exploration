import ast
import unittest
from pathlib import Path
from types import SimpleNamespace


def load_initial_connection():
    """Load the exact helper embedded in its Marimo cell.

    Marimo cells execute independently in the WASM export, so the helper stays
    in the form-rendering cell instead of module scope. Extracting that nested,
    dependency-free function keeps this unit test aligned with the exported
    notebook implementation.
    """
    notebook = Path(__file__).parents[1] / "notebooks" / "hello.py"
    module = ast.parse(notebook.read_text())
    for cell in ast.walk(module):
        if not isinstance(cell, ast.FunctionDef) or cell.name != "_":
            continue
        helper = next(
            (
                statement
                for statement in cell.body
                if isinstance(statement, ast.FunctionDef) and statement.name == "initial_connection"
            ),
            None,
        )
        if helper is not None:
            ast.fix_missing_locations(helper)
            namespace = {}
            exec(compile(ast.Module(body=[helper], type_ignores=[]), str(notebook), "exec"), namespace)
            return namespace["initial_connection"]
    raise AssertionError("initial_connection Marimo cell was not found")


initial_connection = load_initial_connection()


class InitialConnectionTest(unittest.TestCase):
    def setUp(self):
        self.remembered = SimpleNamespace(
            endpoint="remembered.example",
            access_key="remembered-access",
            secure=True,
        )

    def test_complete_environment_connection_takes_precedence(self):
        connection = initial_connection(
            "environment.example", "environment-access", "environment-secret", False, self.remembered
        )

        self.assertEqual(
            connection,
            {
                "endpoint": "environment.example",
                "access": "environment-access",
                "secret": "environment-secret",
                "secure": False,
                "remember": False,
            },
        )

    def test_partial_environment_does_not_mix_secret_with_remembered_connection(self):
        connection = initial_connection("", "", "environment-secret", False, self.remembered)

        self.assertEqual(connection["endpoint"], "remembered.example")
        self.assertEqual(connection["access"], "remembered-access")
        self.assertEqual(connection["secret"], "")
        self.assertTrue(connection["secure"])
        self.assertTrue(connection["remember"])

    def test_partial_environment_endpoint_is_retained_without_its_secret(self):
        connection = initial_connection("environment.example", "", "environment-secret", False, self.remembered)

        self.assertEqual(connection["endpoint"], "environment.example")
        self.assertEqual(connection["access"], "remembered-access")
        self.assertEqual(connection["secret"], "")
        self.assertFalse(connection["secure"])
        self.assertTrue(connection["remember"])

    def test_partial_environment_access_key_is_retained_without_its_secret(self):
        connection = initial_connection("", "environment-access", "environment-secret", False, self.remembered)

        self.assertEqual(connection["endpoint"], "remembered.example")
        self.assertEqual(connection["access"], "environment-access")
        self.assertEqual(connection["secret"], "")
        self.assertTrue(connection["secure"])
        self.assertTrue(connection["remember"])
