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
            ("wildcats.sparcd.arizona.edu", True): ("wildcats.sparcd.arizona.edu", True),
            ("https://wildcats.sparcd.arizona.edu", False): ("wildcats.sparcd.arizona.edu", True),
            ("https://wildcats.sparcd.arizona.edu/", True): ("wildcats.sparcd.arizona.edu", True),
            ("  wildcats.sparcd.arizona.edu  ", True): ("wildcats.sparcd.arizona.edu", True),
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
            "https:///wildcats.sparcd.arizona.edu": "two slashes after “https:”",
            "https:/wildcats.sparcd.arizona.edu": "two slashes after “https:”",
            "https:wildcats.sparcd.arizona.edu": "two slashes after “https:”",
            "https://": "server name is missing",
            ":9000": "server name is missing",
            "wildcats. sparcd.arizona.edu": "Remove the spaces",
            "localhost:abc": "number after the “:”",
            "localhost:99999": "number after the “:”",
            "https://[::1": "doesn't look like a web address",
            "ftp://wildcats.sparcd.arizona.edu": "instead of ftp://",
            "https://user:pass@example.com": "“@” and everything before it",
            "wildcats.sparcd.arizona.edu\tx": "Remove the spaces",
            "https://wildcats.sparcd.arizona.edu/minio/": "Remove “/minio/” from the end",
            "wildcats.sparcd.arizona.edu?": "Remove “?” from the end",
        }
        for raw, fragment in cases.items():
            with self.subTest(raw=raw):
                problem = parse_endpoint(raw, True)[2]
                self.assertIsNotNone(problem)
                self.assertIn(fragment, problem)


if __name__ == "__main__":
    unittest.main()
