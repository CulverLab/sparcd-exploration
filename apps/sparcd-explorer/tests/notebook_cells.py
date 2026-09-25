"""Run the explorer notebook's own data cells in plain Python, for tests.

Each @app.cell function is compiled on its own, the way marimo runs it, and
also returns its locals, so a test can read the numbers a cell renders.
FakeS3 serves an in-memory collection to the real loader cell.
"""

import ast
import csv
import io
from pathlib import Path
from types import SimpleNamespace

NOTEBOOK = Path(__file__).parents[1] / "notebooks" / "hello.py"
BUCKET = "sparcd-test"
PREFIX = "Collections/test/Uploads/"


def _load_cells():
    text = NOTEBOOK.read_text()
    cells = []
    for node in ast.parse(text).body:
        if not isinstance(node, ast.FunctionDef):
            continue
        if not any("app.cell" in ast.unparse(d) for d in node.decorator_list):
            continue
        src = ast.get_source_segment(text, node)
        scope = ast.Call(func=ast.Name("locals", ast.Load()), args=[], keywords=[])
        last = node.body[-1]
        defs = []
        if isinstance(last, ast.Return):
            if isinstance(last.value, ast.Tuple):
                defs = [e.id for e in last.value.elts]
            elif isinstance(last.value, ast.Name):
                defs = [last.value.id]
            node.body[-1] = ast.Return(ast.Tuple([last.value or ast.Constant(None), scope], ast.Load()))
        else:
            node.body.append(ast.Return(ast.Tuple([ast.Constant(None), scope], ast.Load())))
        node.decorator_list = []
        module = ast.fix_missing_locations(ast.Module(body=[node], type_ignores=[]))
        namespace = {}
        exec(compile(module, str(NOTEBOOK), "exec"), namespace)
        cells.append(SimpleNamespace(fn=namespace[node.name], args=[a.arg for a in node.args.args], defs=defs, src=src))
    return cells


CELLS = _load_cells()


def _defining(name):
    return next(c for c in CELLS if name in c.defs)


# From sign-in to stat cards, in notebook order, keyed by a name each cell defines.
PIPELINE = [(name, _defining(name)) for name in (
    "mo", "collection_load_form", "BUCKETS", "deployments", "search_form", "basemap_choice",
    "applied_filters", "locations", "hex_summary", "camera_map", "selected_location_ids",
    "map_dashboard", "selection_report", "location_summary_card", "selected_images_all",
)] + [("stat_row", next(c for c in CELLS if not c.defs and "stat_row" in c.src))]


class FakeS3:
    """One collection bucket whose upload folders hold the three headerless CSVs."""

    def __init__(self):
        self.files, self.uploads = {}, []

    def upload(self, name, deployments=(), media=(), observations=()):
        folder = f"{PREFIX}{name}/"
        self.uploads.append(folder)
        for file, rows in (("deployments.csv", deployments), ("media.csv", media), ("observations.csv", observations)):
            buf = io.StringIO()
            csv.writer(buf).writerows(rows)
            self.files[folder + file] = buf.getvalue().encode()
        return self

    def list_objects(self, bucket, prefix="", recursive=False):
        return [SimpleNamespace(object_name=u, is_dir=True) for u in self.uploads]

    def get_object(self, bucket, key):
        if key not in self.files:
            raise FileNotFoundError(key)
        return io.BytesIO(self.files[key])

    def presigned_get_object(self, bucket, key, expires=None):
        return f"https://s3.invalid/{key}"


def deployment(site, name, lat, lng, elevation=1000):
    return [f"test:{site}", site, name, lng, lat] + [""] * 7 + [elevation]


def media(upload, file, site, timestamp="", mime="image/jpeg"):
    return [f"{PREFIX}{upload}/{file}", f"test:{site}", "", "", timestamp, "", file, mime]


def observation(upload, file, site, timestamp="", common="", scientific="", kind=""):
    """An identification when common or scientific is set, else a placeholder row."""
    row = [""] * 20
    row[1], row[3], row[4], row[5] = f"test:{site}", f"{PREFIX}{upload}/{file}", timestamp, kind
    row[8], row[9] = scientific, "1" if common or scientific else ""
    row[19] = f"[COMMONNAME:{common}]" if common else ""
    return row


def hex_of(location_name):
    """Click the hex holding the named site."""
    def click(ns, map_scope):
        return [next(r["h3_id"] for r in ns["hex_summary"].iter_rows(named=True) if location_name in r["location_names"])]
    return click


def point_of(location_name):
    """Click the named site in exact-sites mode."""
    def click(ns, map_scope):
        return list(next(cd for cd in map_scope["camera_fig"].data[0].customdata if cd[1] == location_name))
    return click


def run_explorer(client, search=None, click=None, points=False):
    """Run the data cells top to bottom.

    search: search-form fields to change from their defaults, or None for the
    view before Search is pressed. click: hex_of(...) or point_of(...), or None.
    points: exact-sites map mode. Returns the cell globals and each cell's
    locals, keyed as in PIPELINE.
    """
    ns = {
        "client": client,
        "is_wildcats_s3_endpoint": points,
        "collections_registry": [{"name": "Test", "org": "", "bucket": BUCKET}],
    }
    scopes = {}
    for key, cell in PIPELINE:
        value, scopes[key] = cell.fn(*[ns[a] for a in cell.args])
        if cell.defs:
            values = value if len(cell.defs) > 1 else (value[0] if isinstance(value, tuple) else value,)
            ns.update(zip(cell.defs, values))
        if key == "search_form":
            defaults = ns["SEARCH_DEFAULTS"]
            ns["search_form"] = SimpleNamespace(value=None if search is None else {
                "mountain_range": [], "site_code": [], "year": [], "month": [], "include_common": [],
                "start_date": defaults["date_start"], "end_date": defaults["date_end"],
                "exclude_common": list(defaults["exclude"]),
                "elevation_range": (defaults["elev_min"], defaults["elev_max"]),
                **search,
            })
        if key == "basemap_choice" and points:
            ns["map_display_mode"] = SimpleNamespace(value="points")
        if key == "camera_map":
            ns["camera_map"] = SimpleNamespace(value=[{"customdata": click(ns, scopes[key])}] if click else [])
    return ns, scopes
