import ast
import unittest
from pathlib import Path


def load_parse_endpoint():
    """Load the dependency-free helper nested in the client Marimo cell."""
    notebook = Path(__file__).parents[1] / "notebooks" / "hello.py"
    for node in ast.walk(ast.parse(notebook.read_text())):
        if isinstance(node, ast.FunctionDef) and node.name == "parse_endpoint":
            namespace = {}
            exec(compile(ast.Module(body=[node], type_ignores=[]), str(notebook), "exec"), namespace)
            return namespace["parse_endpoint"]
    raise AssertionError("parse_endpoint was not found in the notebook")


parse_endpoint = load_parse_endpoint()


class ParseEndpointTest(unittest.TestCase):
    def test_usable_endpoints(self):
        cases = {
            ("server.example.org", True): ("server.example.org", True),
            ("https://server.example.org", False): ("server.example.org", True),
            ("https://server.example.org/", True): ("server.example.org", True),
            ("  server.example.org  ", True): ("server.example.org", True),
            ("localhost", False): ("localhost", False),
            ("localhost:9000", False): ("localhost:9000", False),
            ("http://localhost:9000", True): ("localhost:9000", False),
            ("HTTP://127.0.0.1:9000", True): ("127.0.0.1:9000", False),
            ("[::1]:9000", False): ("[::1]:9000", False),
        }
        for (raw, default_secure), (endpoint, secure) in cases.items():
            with self.subTest(raw=raw):
                self.assertEqual(parse_endpoint(raw, default_secure), (endpoint, secure, None))

    def test_unusable_endpoints_say_what_is_wrong(self):
        cases = {
            "https:///server.example.org": "two slashes after “https:”",
            "https:/server.example.org": "two slashes after “https:”",
            "https:server.example.org": "two slashes after “https:”",
            "https://": "server name is missing",
            ":9000": "server name is missing",
            "server. example.org": "Remove the spaces",
            "localhost:abc": "number after the “:”",
            "localhost:99999": "number after the “:”",
            "https://[::1": "doesn't look like a web address",
            "ftp://server.example.org": "instead of ftp://",
            "https://user:pass@example.com": "“@” and everything before it",
            "server.example.org\tx": "Remove the spaces",
            "https://server.example.org/minio/": "Remove “/minio/” from the end",
            "server.example.org?": "Remove “?” from the end",
        }
        for raw, fragment in cases.items():
            with self.subTest(raw=raw):
                problem = parse_endpoint(raw, True)[2]
                self.assertIsNotNone(problem)
                self.assertIn(fragment, problem)


if __name__ == "__main__":
    unittest.main()
