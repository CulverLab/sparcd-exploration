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

    def test_unusable_endpoints_name_the_problem(self):
        cases = {
            "https:///wildcats.sparcd.arizona.edu": "no host name",
            "https://": "no host name",
            ":9000": "no host name",
            "localhost:abc": "port",
            "localhost:99999": "port",
            "https://[::1": "not valid",
            "https://user:pass@example.com": "access key",
            "ftp://wildcats.sparcd.arizona.edu": "http:// or https://",
            "https://wildcats.sparcd.arizona.edu/bucket": "after the host",
            "https:/wildcats.sparcd.arizona.edu": "after the host",
        }
        for raw, fragment in cases.items():
            with self.subTest(raw=raw):
                problem = parse_endpoint(raw, True)[2]
                self.assertIsNotNone(problem)
                self.assertIn(fragment, problem)


if __name__ == "__main__":
    unittest.main()
