import marimo


__generated_with = "0.23.8"
app = marimo.App(
    width="full",
    app_title="SPARC'd Explorer",
    auto_download=["html"],
)


@app.cell(hide_code=True)
def _():
    import os
    from pathlib import Path
    from urllib.parse import urlparse

    import marimo as mo

    # .env loading: only when python-dotenv is available (i.e. running locally —
    # Pyodide / WASM doesn't have it by default and has no filesystem to read).
    try:
        from dotenv import load_dotenv as _load_dotenv
        _load_dotenv(Path(".env"))
    except ImportError:
        pass

    DEFAULT_ENDPOINT = os.getenv("SPARCD_S3_ENDPOINT", "")
    DEFAULT_ACCESS = os.getenv("SPARCD_S3_ACCESS_KEY", "")
    DEFAULT_SECRET = os.getenv("SPARCD_S3_SECRET_KEY", "")
    DEFAULT_SECURE = os.getenv("SPARCD_S3_SECURE", "true").lower() == "true"

    # Loaded-collection cache keyed by the picked bucket tuple, so re-selecting a
    # collection is instant and changing selection doesn't refetch until submitted.
    SPARCD_COLLECTION_DATA_CACHE = {}

    # Navy paw mark, inlined so the header works identically in local dev and in
    # the Pyodide bundle (no filesystem in WASM — E.10).
    LOGO_DATA_URI = "data:image/png;base64,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"
    THEME_CSS = '''@import url('https://fonts.googleapis.com/css2?family=Newsreader:ital,opsz,wght@0,6..72,400;0,6..72,500;0,6..72,600;1,6..72,400&family=Inter+Tight:wght@400;500;600&family=JetBrains+Mono:wght@400;500&display=swap');

    /* Field Notebook v2 — shared with sparcd-home / tagger / uploader.
       Tokens drive every explorer surface; marimo's own chrome is remapped onto
       the paper palette via the --marimo-* and --background overrides below. */
    :root {
      --paper: #f4ecd8;
      --paperHover: #efe6cc;
      --panel: #fbf7eb;
      --panelHover: #f5efe0;
      --ink: #1c1a14;
      --inkSoft: #4a463b;
      --inkMute: #6b6555;
      --rule: #8c8166;
      --ruleSoft: #cfc4a8;
      --accent: #0b3358;
      --accentSoft: #dfe7ef;
      --warn: #8a3818;
      --ok: #33602e;
      --mark: #ead8a3;

      --marimo-heading-font: 'Newsreader', Georgia, serif;
      --marimo-text-font: 'Inter Tight', Inter, system-ui, sans-serif;
      --marimo-monospace-font: 'JetBrains Mono', ui-monospace, monospace;
      --background: var(--paper);
      --foreground: var(--ink);
    }

    .dark {
      --paper: #211c15;
      --paperHover: #2a241b;
      --panel: #2a241b;
      --panelHover: #332c20;
      --ink: #f0e8d6;
      --inkSoft: #c9bfa6;
      --inkMute: #9a907a;
      --rule: #6b6047;
      --ruleSoft: #3d3528;
      --accent: #7da7d9;
      --accentSoft: #26303d;
      --warn: #d98a5a;
      --ok: #8fbf7f;
      --mark: #5a4d2e;
    }

    /* ── Header band ─────────────────────────────────────────────────────── */
    .sparcd-header {
      display: flex;
      align-items: center;
      gap: 0.7rem;
      flex-wrap: wrap;
      padding: 0.2rem 0 0.85rem;
      margin-bottom: 0.4rem;
      border-bottom: 1px solid var(--rule);
    }
    .sparcd-header img {
      height: 40px;
      width: auto;
      flex-shrink: 0;
    }
    .sparcd-wordmark {
      font-family: 'Newsreader', Georgia, serif;
      font-weight: 600;
      font-size: 1.7rem;
      line-height: 1;
      letter-spacing: -0.01em;
      color: var(--ink);
      white-space: nowrap;
    }
    .sparcd-wordmark .dot {
      color: var(--inkMute);
    }
    .sparcd-wordmark .tool {
      color: var(--inkMute);
      font-weight: 400;
      font-style: italic;
    }
    .sparcd-nav {
      margin-left: auto;
      display: flex;
      gap: 1rem;
      font-family: 'JetBrains Mono', monospace;
      font-size: 0.72rem;
      letter-spacing: 0.06em;
      text-transform: uppercase;
    }
    .sparcd-nav a {
      color: var(--inkMute);
      text-decoration: none;
      border-bottom: 1px solid transparent;
      padding-bottom: 2px;
      transition: color 0.15s ease, border-color 0.15s ease;
    }
    .sparcd-nav a:hover {
      color: var(--accent);
      border-color: var(--accent);
    }

    /* ── Connection chip ─────────────────────────────────────────────────── */
    .sparcd-chip {
      display: inline-flex;
      align-items: center;
      gap: 0.55rem;
      font-family: 'JetBrains Mono', monospace;
      font-size: 0.74rem;
      letter-spacing: 0.03em;
      color: var(--inkSoft);
      padding: 0.35rem 0.7rem;
      border: 1px solid var(--rule);
      background: var(--panel);
    }
    .sparcd-chip .led {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      flex-shrink: 0;
      background: var(--ok);
      box-shadow: 0 0 0 3px color-mix(in srgb, var(--ok) 22%, transparent);
    }
    .sparcd-chip .host {
      color: var(--ink);
      font-weight: 500;
    }
    .sparcd-chip .src {
      color: var(--inkMute);
    }

    /* ── Sidebar section labels ──────────────────────────────────────────── */
    .sparcd-side-label {
      font-family: 'JetBrains Mono', monospace;
      font-size: 0.68rem;
      letter-spacing: 0.12em;
      text-transform: uppercase;
      color: var(--inkMute);
      margin: 0.2rem 0 0.1rem;
    }

    /* ── Panels / cards ──────────────────────────────────────────────────── */
    .sparcd-card {
      border: 1px solid var(--ruleSoft);
      background: var(--panel);
      padding: 0.7rem 0.8rem;
    }
    .sparcd-card .title {
      font-family: 'Newsreader', Georgia, serif;
      font-size: 1.05rem;
      font-weight: 600;
      color: var(--ink);
      margin-bottom: 0.45rem;
    }
    .sparcd-row {
      display: flex;
      justify-content: space-between;
      gap: 0.75rem;
      padding: 0.3rem 0;
      border-bottom: 1px solid var(--ruleSoft);
      font-size: 0.85rem;
    }
    .sparcd-row .k {
      color: var(--inkMute);
    }
    .sparcd-row .v {
      color: var(--ink);
      font-weight: 600;
      font-variant-numeric: tabular-nums;
      text-align: right;
    }
    .sparcd-note {
      color: var(--inkMute);
      font-size: 0.75rem;
      line-height: 1.35;
      margin: 0.4rem 0;
    }

    /* Abundance bars */
    .sparcd-bar-track {
      height: 7px;
      background: var(--mark);
      overflow: hidden;
    }
    .sparcd-bar-fill {
      height: 100%;
      background: var(--accent);
    }

    /* ── Empty state ─────────────────────────────────────────────────────── */
    .sparcd-empty {
      border: 1px dashed var(--rule);
      background: var(--panel);
      padding: 1.6rem 1.4rem;
      text-align: center;
    }
    .sparcd-empty .glyph {
      font-size: 1.8rem;
      line-height: 1;
      margin-bottom: 0.5rem;
    }
    .sparcd-empty .headline {
      font-family: 'Newsreader', Georgia, serif;
      font-size: 1.25rem;
      color: var(--ink);
      margin-bottom: 0.3rem;
    }
    .sparcd-empty .sub {
      color: var(--inkMute);
      font-size: 0.86rem;
      line-height: 1.4;
      max-width: 42ch;
      margin: 0 auto;
    }

    /* ── Warn / error callout ────────────────────────────────────────────── */
    .sparcd-callout {
      border: 1px solid var(--warn);
      background: color-mix(in srgb, var(--warn) 12%, var(--panel));
      color: var(--ink);
      padding: 0.7rem 0.85rem;
      margin: 0.5rem 0;
    }
    .sparcd-callout .t {
      font-weight: 700;
      color: var(--warn);
    }
    .sparcd-callout .d {
      font-size: 0.76rem;
      color: var(--inkMute);
      margin-top: 0.25rem;
    }

    /* ── Thumbnail grid ──────────────────────────────────────────────────── */
    .sparcd-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
      gap: 12px;
      margin-top: 0.5rem;
    }
    .sparcd-grid figure {
      margin: 0;
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    .sparcd-grid img {
      width: 100%;
      aspect-ratio: 4 / 3;
      object-fit: cover;
      background: var(--mark);
      display: block;
      border: 1px solid var(--ruleSoft);
      transition: transform 0.15s ease;
    }
    .sparcd-grid a:hover img {
      transform: scale(1.02);
    }
    .sparcd-grid figcaption {
      font-size: 12px;
      line-height: 1.3;
    }
    .sparcd-grid .fname {
      font-weight: 600;
      color: var(--ink);
    }
    .sparcd-grid .caption {
      color: var(--inkMute);
      word-break: break-word;
    }

    /* ── Map basemap credit ──────────────────────────────────────────────── */
    /* Replaces plotly/maplibre's built-in tile attribution, which escapes the
       clipped map box and overlaps the element below it. Rendered as a normal
       block in the map vstack so it always sits inside the layout flow. */
    .sparcd-map-credit {
      font-family: 'JetBrains Mono', monospace;
      font-size: 0.66rem;
      letter-spacing: 0.04em;
      color: var(--inkMute);
      text-align: right;
      margin-top: -0.55rem;
      padding-right: 0.15rem;
    }

    /* ── Collapsed sidebar ───────────────────────────────────────────────── */
    /* marimo's app-view sidebar (marimo run) narrows the <aside class="app-sidebar">
       to a thin rail when collapsed (data-expanded="false"), but our custom content
       keeps its natural width and bleeds over the main column — clipped labels like
       "COLLECTI", squeezed controls, overlap. Hide the scroll container's contents
       while collapsed; the expand toggle is a separate absolutely-positioned child
       of the <aside>, so it stays visible and clickable. */
    aside.app-sidebar[data-expanded="false"] > div:not(.absolute) {
      overflow: hidden !important;
    }
    aside.app-sidebar[data-expanded="false"] > div:not(.absolute) > * {
      display: none !important;
    }

    /* ── Stat cards ──────────────────────────────────────────────────────── */
    /* Our own markup, NOT mo.stat: <marimo-stat> mounts its card inside an open
       shadow root and only adopts stylesheets that carry an href/title key, so
       this page-level <style> can never reach inside it. These cards are plain
       light-DOM divs the theme fully controls. flex:1 per card gives identical
       widths; the always-rendered caption row (nbsp when empty) plus row stretch
       gives identical heights. */
    .sparcd-stats {
      display: flex;
      flex-wrap: wrap;
      gap: 12px;
    }
    .sparcd-stat {
      flex: 1;
      min-width: 130px;
      display: flex;
      flex-direction: column;
      gap: 0.3rem;
      border: 1px solid var(--rule);
      background: var(--panel);
      padding: 0.7rem 0.85rem;
    }
    .sparcd-stat .label {
      font-family: 'JetBrains Mono', monospace;
      font-size: 0.68rem;
      font-weight: 500;
      letter-spacing: 0.1em;
      text-transform: uppercase;
      color: var(--inkMute);
    }
    .sparcd-stat .value {
      font-family: 'Newsreader', Georgia, serif;
      font-size: 1.7rem;
      font-weight: 600;
      line-height: 1.1;
      color: var(--ink);
      font-variant-numeric: tabular-nums;
    }
    .sparcd-stat .caption {
      font-size: 0.72rem;
      line-height: 1.3;
      color: var(--inkMute);
      font-variant-numeric: tabular-nums;
    }
    '''
    return (
        DEFAULT_ACCESS,
        DEFAULT_ENDPOINT,
        DEFAULT_SECRET,
        DEFAULT_SECURE,
        LOGO_DATA_URI,
        SPARCD_COLLECTION_DATA_CACHE,
        THEME_CSS,
        mo,
        urlparse,
    )


@app.cell(hide_code=True)
def _(THEME_CSS, mo):
    # Field Notebook v2 theme, inlined as a <style> so it applies in BOTH the
    # local server and the WASM html export. css_file= does not survive the
    # export (its path resolves against the export cwd, not the notebook — E.3).
    #
    # title="marimo-theme" is load-bearing. marimo's plugin web components
    # (marimo-tabs, marimo-accordion, marimo-sidebar, …) mount their content in an
    # OPEN shadow root and re-parse their HTML children INSIDE that shadow tree, so
    # this page-level <style> can't reach them. Their copyStyles() only adopts a
    # document stylesheet into the shadow root when it has an href, a
    # data-vite-dev-id, or a title starting with "marimo" (the xc() filter in the
    # frontend). Giving the sheet this title makes THEME_CSS penetrate every
    # component shadow root at once — fixing the thumbnail grid, detection controls,
    # location summary cards, and every other theme-classed node composed inside a
    # plugin (previously they rendered unstyled: the grid collapsed to full-width
    # stacked images because .sparcd-grid never applied).
    mo.Html('<style title="marimo-theme">' + THEME_CSS + '</style>')
    return


@app.cell(hide_code=True)
def _(LOGO_DATA_URI, mo):
    # Field Notebook header band — always first, no data dependency so it renders
    # before (and independently of) any S3 connection.
    mo.Html(
        "<header class='sparcd-header'>"
        f"<img src='{LOGO_DATA_URI}' alt='' />"
        "<span class='sparcd-wordmark'>SPARC'd "
        "<span class='dot'>·</span> <span class='tool'>Explorer</span></span>"
        "<nav class='sparcd-nav'>"
        "<a href='../'>Home</a>"
        "<a href='../uploader/'>Uploader</a>"
        "<a href='../tagger/'>Tagger</a>"
        "</nav>"
        "</header>"
    )
    return


@app.cell(hide_code=True)
def _():
    # Bridges the (non-secret) connection fields to this browser's localStorage,
    # mirroring the Tagger/Uploader apps' "Remember me" behavior — the secret key
    # is never persisted. anywidget runs the same in the local server and in the
    # Pyodide/WASM export; verified directly against an exported bundle (E.11).
    import anywidget
    import traitlets

    class StoredConnectionReader(anywidget.AnyWidget):
        """Reads the remembered connection fields from localStorage once, on
        mount, so the credentials form can prefill from them."""

        _esm = """
        function render({ model, el }) {
          let stored = {};
          try {
            const raw = localStorage.getItem(model.get("storage_key"));
            stored = raw ? JSON.parse(raw) : {};
          } catch (e) {
            /* storage unavailable (private mode) or corrupt value — treat as empty */
          }
          model.set("endpoint", stored.endpoint || "");
          model.set("access_key", stored.accessKey || "");
          model.set("secure", typeof stored.secure === "boolean" ? stored.secure : false);
          model.save_changes();
        }
        export default { render };
        """

        storage_key = traitlets.Unicode("sparcd-connection").tag(sync=True)
        endpoint = traitlets.Unicode("").tag(sync=True)
        access_key = traitlets.Unicode("").tag(sync=True)
        secure = traitlets.Bool(False).tag(sync=True)

    class StoredConnectionWriter(anywidget.AnyWidget):
        """Persists (or clears) the remembered connection fields whenever the
        submitted endpoint/access key or the Remember checkbox changes."""

        _esm = """
        function render({ model, el }) {
          function sync() {
            const key = model.get("storage_key");
            try {
              if (model.get("remember")) {
                const raw = localStorage.getItem(key);
                const stored = raw ? JSON.parse(raw) : {};
                localStorage.setItem(
                  key,
                  JSON.stringify({
                    ...stored,
                    endpoint: model.get("endpoint"),
                    accessKey: model.get("access_key"),
                    secure: model.get("secure"),
                  }),
                );
              } else {
                localStorage.removeItem(key);
              }
            } catch (e) {
              /* storage unavailable (private mode / quota) — nothing to do */
            }
          }
          // A re-instantiation from Python may reuse this same mounted widget
          // rather than remounting it, so `render` can run only once while the
          // traits keep changing — react to those updates too, not just the
          // initial values.
          sync();
          model.on("change:endpoint", sync);
          model.on("change:access_key", sync);
          model.on("change:secure", sync);
          model.on("change:remember", sync);
        }
        export default { render };
        """

        storage_key = traitlets.Unicode("sparcd-connection").tag(sync=True)
        endpoint = traitlets.Unicode("").tag(sync=True)
        access_key = traitlets.Unicode("").tag(sync=True)
        secure = traitlets.Bool(False).tag(sync=True)
        remember = traitlets.Bool(False).tag(sync=True)

    return StoredConnectionReader, StoredConnectionWriter


@app.cell(hide_code=True)
def _(StoredConnectionReader, mo):
    remembered = mo.ui.anywidget(StoredConnectionReader())
    remembered
    return (remembered,)


@app.cell(hide_code=True)
def _(DEFAULT_ACCESS, DEFAULT_ENDPOINT, DEFAULT_SECRET, DEFAULT_SECURE, mo, remembered):
    # S3 / MinIO credentials. Values prefill from .env when present, so a working
    # local .env connects without submitting; failing that, from a remembered
    # browser connection. Deployed users sign in via the form (rendered in the
    # sidebar). This cell only defines the form; it does not display.
    def initial_connection(default_endpoint, default_access, default_secret, default_secure, remembered):
        """Choose browser form defaults without combining a partial secret source."""
        has_default_connection = bool(default_endpoint and default_access and default_secret)
        if has_default_connection:
            return {
                "endpoint": default_endpoint,
                "access": default_access,
                "secret": default_secret,
                "secure": default_secure,
                "remember": False,
            }

        uses_remembered_endpoint = not default_endpoint and bool(remembered.endpoint)
        uses_remembered_access = not default_access and bool(remembered.access_key)
        return {
            "endpoint": default_endpoint or remembered.endpoint,
            "access": default_access or remembered.access_key,
            "secret": "",
            "secure": default_secure if default_endpoint else remembered.secure,
            "remember": uses_remembered_endpoint or uses_remembered_access,
        }

    _initial = initial_connection(
        DEFAULT_ENDPOINT,
        DEFAULT_ACCESS,
        DEFAULT_SECRET,
        DEFAULT_SECURE,
        remembered,
    )

    _endpoint_in = mo.ui.text(
        value=_initial["endpoint"],
        label="Endpoint",
        placeholder="host[:port] or https://host",
        full_width=True,
    )
    _access_in = mo.ui.text(value=_initial["access"], label="Access key", full_width=True)
    _secret_in = mo.ui.text(value=_initial["secret"], label="Secret key", kind="password", full_width=True)
    _secure_in = mo.ui.checkbox(
        value=_initial["secure"],
        label="Use HTTPS (when no scheme in endpoint)",
    )
    _remember_in = mo.ui.checkbox(
        value=_initial["remember"],
        label="Remember endpoint & access key on this device",
    )

    creds_form = (
        mo.md("""
        {endpoint}

        {access}

        {secret}

        {secure}

        {remember}
        """)
        .batch(
            endpoint=_endpoint_in,
            access=_access_in,
            secret=_secret_in,
            secure=_secure_in,
            remember=_remember_in,
        )
        .form(label="", bordered=False, show_clear_button=True, submit_button_label="Connect")
    )
    return (creds_form,)


@app.cell(hide_code=True)
def _(StoredConnectionWriter, creds_form, mo):
    # Persists (or explicitly forgets) the submitted connection only on an
    # actual Connect — never on the .env-driven first render — mirroring the
    # Tagger/Uploader apps, which save at connect() time, not per keystroke.
    _submitted = creds_form.value
    remember_sync = None
    if _submitted is not None:
        remember_sync = mo.ui.anywidget(
            StoredConnectionWriter(
                endpoint=_submitted["endpoint"] if _submitted.get("remember") else "",
                access_key=_submitted["access"] if _submitted.get("remember") else "",
                secure=bool(_submitted.get("secure")),
                remember=bool(_submitted.get("remember")),
            )
        )
    remember_sync
    return


@app.cell(hide_code=True)
def _(
    DEFAULT_ACCESS,
    DEFAULT_ENDPOINT,
    DEFAULT_SECRET,
    DEFAULT_SECURE,
    creds_form,
    mo,
    urlparse,
):
    # Build the MinIO client from the submitted credentials, falling back to .env
    # defaults on first load. Renders a compact connection chip.
    _form_value = creds_form.value
    if _form_value is None:
        _creds = {
            "endpoint": DEFAULT_ENDPOINT,
            "access": DEFAULT_ACCESS,
            "secret": DEFAULT_SECRET,
            "secure": DEFAULT_SECURE,
        } if (DEFAULT_ENDPOINT and DEFAULT_ACCESS and DEFAULT_SECRET) else None
    else:
        _creds = _form_value

    # Deliberately NO mo.stop here. mo.stop halts this cell AND every downstream
    # cell — including the single sidebar cell that hosts the sign-in form. In the
    # deployed WASM bundle (no .env to auto-connect) that was a hard deadlock: no
    # client -> sidebar cell never ran -> no sidebar -> the user could never enter
    # credentials. Instead, with no usable credentials we define client=None and let
    # the data cells degrade to empty-schema dataframes, so the whole app (and the
    # sidebar above all) always renders.
    if not _creds or not _creds.get("endpoint") or not _creds.get("access") or not _creds.get("secret"):
        client = None
        is_wildcats_s3_endpoint = False
        _connection_chip = mo.Html(
            "<div class='sparcd-chip'><span class='led' style='background:var(--warn);"
            "box-shadow:0 0 0 3px color-mix(in srgb, var(--warn) 22%, transparent);'></span>"
            "<span>Enter S3 credentials in the sidebar to load data.</span></div>"
        )
    else:
        from minio import Minio

        _raw = _creds["endpoint"]
        if "://" in _raw:
            _u = urlparse(_raw)
            _ep = _u.netloc
            _secure = _u.scheme == "https"
        else:
            _ep = _raw
            _secure = bool(_creds["secure"])

        # Exact-site point display is a data-protection concern; gate it to the trusted host.
        _host = (urlparse(f"//{_ep}").hostname or "").lower().rstrip(".")
        is_wildcats_s3_endpoint = _host == "wildcats.sparcd.arizona.edu"

        client = Minio(_ep, access_key=_creds["access"], secret_key=_creds["secret"], secure=_secure)
        _src = "form" if _form_value is not None else ".env"
        from html import escape as _esc_ep
        _connection_chip = mo.Html(
            "<div class='sparcd-chip'><span class='led'></span>"
            f"<span>Connected to <span class='host'>{_esc_ep(_ep)}</span></span>"
            f"<span class='src'>· {'https' if _secure else 'http'} · from {_src}</span></div>"
        )
    _connection_chip
    return client, is_wildcats_s3_endpoint


@app.cell(hide_code=True)
def _(client, mo):
    # Collection registry. Reads every sparcd-<uuid> bucket's collection.json so the
    # picker can show human-readable names; surfaces S3 errors as friendly callouts.
    import json as _json
    from html import escape as _esc

    collections_registry = []
    _connection_failed = False
    _callout = None

    def _error_callout(title, hint, detail_label, detail):
        return mo.Html(
            "<div class='sparcd-callout'>"
            f"<div class='t'>{_esc(title)}</div>"
            f"<div>{_esc(hint)}</div>"
            f"<div class='d'>{_esc(detail_label)}: {_esc(detail)}</div>"
            "</div>"
        )

    # client is None until the user signs in (deployed bundle) or .env auto-connects.
    # Skip all S3 work in that state so the registry stays empty and NO error callout
    # is shown — the connection chip already tells the user to enter credentials.
    if client is not None:
        from minio.error import S3Error as _S3Error

        try:
            with mo.status.spinner(title="Reading collections…"):
                _buckets = [b.name for b in client.list_buckets() if b.name.startswith("sparcd-")]
        except _S3Error as exc:
            _detail = exc.code or exc.message or str(exc)
            _hint = (
                "Check the endpoint, access key, secret key, and HTTPS setting."
                if exc.code in {"AccessDenied", "InvalidAccessKeyId", "SignatureDoesNotMatch"}
                else "Check the endpoint, credentials, and network access."
            )
            _callout = _error_callout("Could not connect to S3.", _hint, "S3 response", _detail)
            _connection_failed = True
            _buckets = []
        except Exception as exc:
            _callout = _error_callout(
                "Could not connect to S3.",
                "Check the endpoint, credentials, and network access.",
                "Error",
                str(exc),
            )
            _connection_failed = True
            _buckets = []

        if not _buckets and not _connection_failed:
            _callout = mo.Html(
                "<div class='sparcd-callout'>"
                "<div class='t'>No accessible SPARC'd collections found.</div>"
                "<div>Check that the endpoint, access key, secret key, and HTTPS setting match an "
                "account with access to the Educational Test collection.</div>"
                "</div>"
            )

        for _b in _buckets:
            _uuid = _b.removeprefix("sparcd-")
            try:
                _meta = _json.loads(client.get_object(_b, f"Collections/{_uuid}/collection.json").read())
                _name = _meta.get("nameProperty") or _meta.get("name") or _uuid
                _org = _meta.get("organizationProperty") or ""
                collections_registry.append({"bucket": _b, "uuid": _uuid, "name": _name, "org": _org})
            except _S3Error:
                continue

    collections_registry.sort(key=lambda r: (r["name"].strip().lower(), r["bucket"]))
    _callout if _callout is not None else None
    return (collections_registry,)


@app.cell(hide_code=True)
def _(collections_registry, mo):
    # Collection picker + its own Load submit. Changing the selection does nothing
    # until "Load selected collection" is pressed (A.1). Displayed in the sidebar.
    _options = {f"{c['name']}   ({c['org']})" if c['org'] else c['name']: c['bucket']
                for c in collections_registry}

    _default = next(
        (k for k in _options if "educational" in k.lower() and "test" in k.lower()),
        next(iter(_options), None),
    )

    collection_picker = mo.ui.multiselect(
        options=_options,
        value=[_default] if _default else [],
        label="Collection",
        full_width=True,
    )
    DEFAULT_COLLECTION_BUCKETS = [_options[_default]] if _default else []
    collection_load_form = (
        mo.md("{collections}")
        .batch(collections=collection_picker)
        .form(
            label="",
            bordered=False,
            submit_button_label="Load selected collection",
            show_clear_button=False,
        )
    )
    return DEFAULT_COLLECTION_BUCKETS, collection_load_form


@app.cell(hide_code=True)
def _(DEFAULT_COLLECTION_BUCKETS, collection_load_form):
    # Selected buckets + their prefixes. Falls back to the default until the form
    # is submitted, so the app loads a collection on first render.
    _submitted = collection_load_form.value
    BUCKETS = list((_submitted or {}).get("collections") or DEFAULT_COLLECTION_BUCKETS)
    UPLOADS_PREFIXES = [
        (b, f"Collections/{b.removeprefix('sparcd-')}/Uploads/")
        for b in BUCKETS
    ]
    None
    return BUCKETS, UPLOADS_PREFIXES


@app.cell(hide_code=True)
def _(BUCKETS, SPARCD_COLLECTION_DATA_CACHE, UPLOADS_PREFIXES, client, mo):
    import csv
    import io

    import polars as pl


    def _read_csv(bucket: str, key: str) -> list[list[str]]:
        raw = client.get_object(bucket, key).read().decode("utf-8", errors="replace")
        return [row for row in csv.reader(io.StringIO(raw)) if row]


    DEPLOY_COLS = ["deployment_id", "location_id", "location_name",
                   "longitude", "latitude", "_d5", "_d6", "_d7",
                   "_d8", "_d9", "_d10", "_d11", "elevation"]
    MEDIA_COLS = ["media_path", "deployment_id", "_p2", "_p3", "_p4",
                  "_p5", "file_name", "mime_type"]
    OBS_COLS = ["_p0", "deployment_id", "_p2", "media_path", "timestamp",
                "_p5", "_p6", "_p7", "scientific_name", "count",
                "_p10", "_p11", "_p12", "_p13", "_p14", "_p15", "_p16",
                "_p17", "_p18", "tags"]


    def _to_df(rows, buckets, cols):
        if not rows:
            sch = {c: pl.Utf8 for c in cols}
            sch["bucket"] = pl.Utf8
            return pl.DataFrame({c: [] for c in cols + ["bucket"]}, schema=sch)
        width = len(cols)
        fixed = [(r + [""] * width)[:width] for r in rows]
        df = pl.DataFrame(fixed, schema=cols, orient="row")
        df = df.with_columns(pl.Series("bucket", buckets))
        return df.select(cols + ["bucket"])


    _dep_rows, _dep_buckets = [], []
    _media_rows, _media_buckets = [], []
    _obs_rows, _obs_buckets = [], []
    total_uploads = 0

    _cache = SPARCD_COLLECTION_DATA_CACHE
    _cache_key = tuple(BUCKETS)
    _cached = _cache.get(_cache_key)

    if _cached is None:
        with mo.status.spinner(title="Loading collection…", subtitle="Fetching deployments, media, observations"):
            for bucket, prefix in UPLOADS_PREFIXES:
                try:
                    uploads = [
                        o.object_name
                        for o in client.list_objects(bucket, prefix=prefix, recursive=False)
                        if o.is_dir and o.object_name != prefix
                    ]
                except Exception:
                    uploads = []
                total_uploads += len(uploads)
                for up in uploads:
                    try:
                        rows = _read_csv(bucket, up + "deployments.csv")
                        _dep_rows += rows
                        _dep_buckets += [bucket] * len(rows)
                    except Exception:
                        pass
                    try:
                        rows = _read_csv(bucket, up + "media.csv")
                        _media_rows += rows
                        _media_buckets += [bucket] * len(rows)
                    except Exception:
                        pass
                    try:
                        rows = _read_csv(bucket, up + "observations.csv")
                        _obs_rows += rows
                        _obs_buckets += [bucket] * len(rows)
                    except Exception:
                        pass

        deployments = (
            _to_df(_dep_rows, _dep_buckets, DEPLOY_COLS + [f"_d{i}" for i in range(13, 50)])
            .select(DEPLOY_COLS + ["bucket"])
            .with_columns(
                pl.col("latitude").cast(pl.Float64, strict=False),
                pl.col("longitude").cast(pl.Float64, strict=False),
                pl.col("elevation").cast(pl.Float64, strict=False),
            )
            .filter(pl.col("latitude").is_not_null() & pl.col("longitude").is_not_null())
        )
        media = (
            _to_df(_media_rows, _media_buckets, MEDIA_COLS + [f"_m{i}" for i in range(50)])
            .select(MEDIA_COLS + ["bucket"])
        )
        observations = (
            _to_df(_obs_rows, _obs_buckets, OBS_COLS + [f"_o{i}" for i in range(50)])
            .select(OBS_COLS + ["bucket"])
        )
        _cached = {
            "deployments": deployments,
            "media": media,
            "observations": observations,
            "total_uploads": total_uploads,
        }
        _cache[_cache_key] = _cached

    deployments = _cached["deployments"]
    media = _cached["media"]
    observations = _cached["observations"]
    total_uploads = _cached["total_uploads"]
    None
    return deployments, media, observations, pl


@app.cell(hide_code=True)
def _(deployments, mo, observations, pl):
    # Query filters, batched into ONE form (D). Nothing recomputes while the user
    # adjusts controls; only "Search" applies them. Option lists are derived from
    # loaded observations/deployments and rebuild on collection load (that's fine).
    import datetime as _dt
    import re as _re

    _ts = observations.filter(pl.col("timestamp").str.len_chars() >= 10)["timestamp"]
    if _ts.len() > 0:
        _min_d = _dt.date.fromisoformat(_ts.min()[:10])
        _max_d = _dt.date.fromisoformat(_ts.max()[:10])
    else:
        _min_d = _dt.date(2010, 1, 1)
        _max_d = _dt.date(2030, 12, 31)

    _pat = _re.compile(r"COMMONNAME:([^\]]+)")
    _species_counts = {}
    for _t in observations["tags"].to_list():
        if not _t:
            continue
        for _m in _pat.findall(_t):
            _species_counts[_m] = _species_counts.get(_m, 0) + 1
    _species_options = sorted(_species_counts, key=lambda k: (-_species_counts[k], k.lower()))
    _default_excluded = [n for n in _species_options if any(k in n.lower() for k in ("ghost", "test"))]

    _site_options = sorted({v for v in deployments["location_id"].to_list() if v and v != "0000"})
    _range_options = sorted({v[:3] for v in _site_options if len(v) >= 3})
    _year_options = sorted(
        {str(v)[:4] for v in observations["timestamp"].to_list() if v and len(str(v)) >= 4}
    )
    _month_options = sorted(
        {str(v)[5:7] for v in observations["timestamp"].to_list() if v and len(str(v)) >= 7}
    )
    _elev = deployments.filter(pl.col("elevation").is_not_null())["elevation"]
    if _elev.len() > 0:
        _e_min = int(_elev.min())
        _e_max = int(_elev.max())
    else:
        _e_min = 0
        _e_max = 0
    _e_stop = max(_e_min + 1, _e_max)

    _mountain_range = mo.ui.multiselect(options=_range_options, value=[], label="Mountain range")
    _site_code = mo.ui.multiselect(options=_site_options, value=[], label="Site code / location")
    _year = mo.ui.multiselect(options=_year_options, value=[], label="Year")
    _month = mo.ui.multiselect(options=_month_options, value=[], label="Month")
    _start_date = mo.ui.date(start=_min_d, stop=_max_d, value=_min_d, label="Start date")
    _end_date = mo.ui.date(start=_min_d, stop=_max_d, value=_max_d, label="End date")
    _include_common = mo.ui.multiselect(options=_species_options, value=[], label="Species (include only)")
    _exclude_common = mo.ui.multiselect(options=_species_options, value=_default_excluded, label="Exclude species/tags")
    _elevation_range = mo.ui.range_slider(
        start=_e_min,
        stop=_e_stop,
        step=1,
        value=[_e_min, _e_stop],
        label="Elevation",
        show_value=True,
        disabled=_elev.len() == 0,
    )

    search_form = (
        mo.md(
            """
            {mountain_range}

            {site_code}

            {start_date}  {end_date}

            {year}  {month}

            {include_common}

            {exclude_common}

            {elevation_range}
            """
        )
        .batch(
            mountain_range=_mountain_range,
            site_code=_site_code,
            start_date=_start_date,
            end_date=_end_date,
            year=_year,
            month=_month,
            include_common=_include_common,
            exclude_common=_exclude_common,
            elevation_range=_elevation_range,
        )
        .form(label="", bordered=False, submit_button_label="Search")
    )
    # Defaults applied before the first Search so the app isn't blank on load.
    SEARCH_DEFAULTS = {
        "date_start": _min_d,
        "date_end": _max_d,
        "exclude": _default_excluded,
        "elev_min": _e_min,
        "elev_max": _e_stop,
    }
    return SEARCH_DEFAULTS, search_form


@app.cell(hide_code=True)
def _(is_wildcats_s3_endpoint, mo):
    # Display-only options: cheap, so they stay live-reactive (D). They change how
    # data is shown, never which rows the query returns. Displayed in the sidebar.
    show_species_columns = mo.ui.checkbox(value=True, label="Species columns in table")
    coordinate_format = mo.ui.dropdown(
        options={"Lat/long": "latlong", "UTM": "utm"},
        value="Lat/long",
        label="Coordinate display",
    )
    coordinate_method = mo.ui.dropdown(
        options={"Round coordinates": "round", "Truncate coordinates": "truncate"},
        value="Round coordinates",
        label="Coordinate security",
    )
    coordinate_digits = mo.ui.dropdown(
        options={
            "Exact": None,
            "0 decimals": 0,
            "1 decimal": 1,
            "2 decimals": 2,
            "3 decimals": 3,
            "4 decimals": 4,
            "5 decimals": 5,
        },
        value="3 decimals",
        label="Coordinate digits",
    )
    elevation_unit = mo.ui.dropdown(
        options={"Meters": "meters", "Feet": "feet"},
        value="Meters",
        label="Elevation display",
    )
    basemap_choice = mo.ui.dropdown(
        options=["Topo", "Imagery", "Shaded relief", "Stewardship", "OpenStreetMap", "Light"],
        value="Topo",
        label="Basemap",
    )
    if is_wildcats_s3_endpoint:
        map_display_mode = mo.ui.dropdown(
            options={"Hex cells": "hex", "Exact sites": "points"},
            value="Hex cells",
            label="Map display",
        )
    else:
        from types import SimpleNamespace as _SimpleNamespace

        map_display_mode = _SimpleNamespace(value="hex")

    display_options = mo.vstack([
        coordinate_format,
        coordinate_method,
        coordinate_digits,
        elevation_unit,
        show_species_columns,
    ] + ([map_display_mode] if is_wildcats_s3_endpoint else []))
    return (
        basemap_choice,
        coordinate_digits,
        coordinate_format,
        coordinate_method,
        display_options,
        elevation_unit,
        map_display_mode,
        show_species_columns,
    )


@app.cell(hide_code=True)
def _(
    client,
    collection_load_form,
    creds_form,
    display_options,
    mo,
    search_form,
):
    # ONE sidebar for the whole app, in a single cell. marimo mounts each
    # `marimo-sidebar` element into a shared slot keyed by a per-element id; when a
    # cell re-runs, marimo builds a FRESH element that re-registers at the END of
    # that slot. Two separate sidebar cells therefore reorder non-deterministically
    # as their cells re-run at different times (Connection re-runs on Connect, the
    # others on collection load) — so the login section could drop below the rest,
    # or land in normal page flow (the "login at the bottom of the page" symptom).
    # A single sidebar registered once from one cell is order-stable. mo.sidebar
    # must be the cell's LAST expression to render.
    #
    # This cell depends on `client` only to decide whether to show the sign-in hint;
    # it NEVER short-circuits, so the Connection form is always present. Before a
    # connection the Collection and Query-filter sections show a muted note instead
    # of their (empty) forms; Display options stay live since they're display-only.
    _not_connected = client is None
    _signin = (
        "<div class='sparcd-note' style='margin:0 0 0.3rem;'>"
        "Sign in above to load this section.</div>"
    )
    mo.sidebar([
        mo.Html("<div class='sparcd-side-label'>Connection</div>"),
        creds_form,
        mo.Html("<div class='sparcd-side-label'>Collection</div>"),
        mo.Html(_signin) if _not_connected else collection_load_form,
        mo.Html("<div class='sparcd-side-label'>Query filters</div>"),
        mo.Html(_signin) if _not_connected else search_form,
        mo.Html("<div class='sparcd-side-label'>Display options</div>"),
        display_options,
    ])
    return


@app.cell(hide_code=True)
def _(SEARCH_DEFAULTS, deployments, media, observations, pl, search_form):
    # Apply the batched query filters (Pyodide-safe). Reads search_form.value so
    # results only change on Search; before the first submit it uses SEARCH_DEFAULTS.
    import re as _re_filt

    _fv = search_form.value
    if _fv is None:
        _included = set()
        _excluded = set(SEARCH_DEFAULTS["exclude"])
        _ranges = set()
        _sites = set()
        _years = set()
        _months = set()
        _d_start = SEARCH_DEFAULTS["date_start"]
        _d_end = SEARCH_DEFAULTS["date_end"]
        _elev_min = SEARCH_DEFAULTS["elev_min"]
        _elev_max = SEARCH_DEFAULTS["elev_max"]
    else:
        _included = set(_fv["include_common"] or [])
        _excluded = set(_fv["exclude_common"] or [])
        _ranges = set(_fv["mountain_range"] or [])
        _sites = set(_fv["site_code"] or [])
        _years = set(_fv["year"] or [])
        _months = set(_fv["month"] or [])
        _d_start, _d_end = _fv["start_date"], _fv["end_date"]
        _elev_min, _elev_max = _fv["elevation_range"]

    if _d_start > _d_end:
        _d_start, _d_end = _d_end, _d_start
    _d_start_s, _d_end_s = str(_d_start), str(_d_end)

    _deployments_scope = deployments
    if _ranges:
        _deployments_scope = _deployments_scope.filter(
            pl.col("location_id").str.slice(0, 3).is_in(list(_ranges))
        )
    if _sites:
        _deployments_scope = _deployments_scope.filter(pl.col("location_id").is_in(list(_sites)))
    _deployments_scope = _deployments_scope.filter(
        pl.col("elevation").is_null()
        | ((pl.col("elevation") >= _elev_min) & (pl.col("elevation") <= _elev_max))
    )
    _deployment_ids = _deployments_scope["deployment_id"].unique().to_list()

    _obs_scope = observations.filter(pl.col("deployment_id").is_in(_deployment_ids))
    _media_scope = media.filter(pl.col("deployment_id").is_in(_deployment_ids))

    _obs_dated = _obs_scope.filter(
        (pl.col("timestamp").str.len_chars() < 10)
        | ((pl.col("timestamp").str.slice(0, 10) >= _d_start_s)
           & (pl.col("timestamp").str.slice(0, 10) <= _d_end_s))
    )
    if _years:
        _obs_dated = _obs_dated.filter(pl.col("timestamp").str.slice(0, 4).is_in(list(_years)))
    if _months:
        _obs_dated = _obs_dated.filter(pl.col("timestamp").str.slice(5, 2).is_in(list(_months)))

    if not _included and not _excluded:
        observations_filtered = _obs_dated
    else:
        _pat = _re_filt.compile(r"COMMONNAME:([^\]]+)")

        def _keep_row(t):
            names = set(_pat.findall(t)) if t else set()
            if _included and not (names & _included):
                return False
            if _excluded and names and names.issubset(_excluded):
                return False
            return True

        _mask = [_keep_row(t) for t in _obs_dated["tags"].to_list()]
        observations_filtered = _obs_dated.filter(pl.Series("_keep", _mask))

    # Keep untagged media in the totals: a path stays if it survived the species
    # filter OR if it never appears in any dated observation (untagged frame).
    _kept_paths = observations_filtered["media_path"].unique().to_list()
    _dated_obs_paths = _obs_dated["media_path"].unique().to_list()
    media_filtered = _media_scope.filter(
        pl.col("media_path").is_in(_kept_paths)
        | ~pl.col("media_path").is_in(_dated_obs_paths)
    )
    # Derive from media_filtered so never-tagged deployments (media but zero
    # observations) stay visible on the map and in the stat cards; sites whose
    # observations all fail the species/date filters still drop out unless they
    # also have untagged frames preserved by the C.2 filter above.
    query_deployment_ids = media_filtered["deployment_id"].unique().to_list()
    applied_filters = {
        "include": sorted(_included),
        "exclude": sorted(_excluded),
        "date_start": _d_start,
        "date_end": _d_end,
    }
    None
    return (
        applied_filters,
        media_filtered,
        observations_filtered,
        query_deployment_ids,
    )


@app.cell(hide_code=True)
def _(
    coordinate_digits,
    coordinate_format,
    coordinate_method,
    deployments,
    elevation_unit,
    media_filtered,
    mo,
    observations_filtered,
    pl,
    query_deployment_ids,
    show_species_columns,
):
    # Normalize deployments; attach image counts using the FILTERED media/observations.
    _locations_raw = (
        deployments
        .with_columns(
            pl.when(pl.col("latitude").abs() > 90)
            .then(pl.col("longitude"))
            .otherwise(pl.col("latitude"))
            .alias("lat_fixed"),
            pl.when(pl.col("latitude").abs() > 90)
            .then(pl.col("latitude"))
            .otherwise(pl.col("longitude"))
            .alias("lng_fixed"),
        )
        .drop("latitude", "longitude")
        .rename({"lat_fixed": "latitude", "lng_fixed": "longitude"})
        .filter(pl.col("deployment_id").is_in(query_deployment_ids))
        .filter(pl.col("location_id") != "0000")
        .filter(pl.col("latitude").is_not_null() & pl.col("longitude").is_not_null())
        .with_columns(pl.col("location_id").str.slice(0, 3).alias("mountain_range"))
    )

    # Total images from filtered media (includes untagged frames); tagged images
    # from the filtered observations (distinct tagged media paths).
    _image_counts = media_filtered.group_by("deployment_id").agg(
        pl.col("media_path").n_unique().alias("image_count")
    )
    _obs_counts = observations_filtered.group_by("deployment_id").agg(
        pl.col("media_path").n_unique().alias("tagged_image_count")
    )

    locations = (
        _locations_raw
        .join(_image_counts, on="deployment_id", how="left")
        .join(_obs_counts, on="deployment_id", how="left")
        .group_by("mountain_range", "location_id", "location_name", "latitude", "longitude")
        .agg(
            pl.col("deployment_id").unique().alias("deployment_ids"),
            pl.col("elevation").mean().round(0).alias("elevation"),
            pl.col("image_count").sum().fill_null(0).alias("image_count"),
            pl.col("tagged_image_count").sum().fill_null(0).alias("tagged_image_count"),
        )
        .sort("location_name")
    )

    _locations_table = locations.drop("deployment_ids")
    if elevation_unit.value == "feet":
        _locations_table = _locations_table.with_columns(
            (pl.col("elevation") * 3.28084).round(0).alias("elevation_ft")
        ).drop("elevation")
    else:
        _locations_table = _locations_table.rename({"elevation": "elevation_m"})

    if coordinate_format.value == "utm":
        import math as _math

        def _latlon_to_utm(lat, lon):
            _zone = int((lon + 180) / 6) + 1
            _hemisphere = "N" if lat >= 0 else "S"
            _a = 6378137.0
            _ecc_sq = 0.00669438
            _k0 = 0.9996
            _lat_rad = _math.radians(lat)
            _lon_rad = _math.radians(lon)
            _lon_origin = (_zone - 1) * 6 - 180 + 3
            _lon_origin_rad = _math.radians(_lon_origin)
            _ecc_prime_sq = _ecc_sq / (1 - _ecc_sq)
            _n = _a / _math.sqrt(1 - _ecc_sq * _math.sin(_lat_rad) ** 2)
            _t = _math.tan(_lat_rad) ** 2
            _c = _ecc_prime_sq * _math.cos(_lat_rad) ** 2
            _aa = _math.cos(_lat_rad) * (_lon_rad - _lon_origin_rad)
            _m = _a * (
                (1 - _ecc_sq / 4 - 3 * _ecc_sq ** 2 / 64 - 5 * _ecc_sq ** 3 / 256) * _lat_rad
                - (3 * _ecc_sq / 8 + 3 * _ecc_sq ** 2 / 32 + 45 * _ecc_sq ** 3 / 1024) * _math.sin(2 * _lat_rad)
                + (15 * _ecc_sq ** 2 / 256 + 45 * _ecc_sq ** 3 / 1024) * _math.sin(4 * _lat_rad)
                - (35 * _ecc_sq ** 3 / 3072) * _math.sin(6 * _lat_rad)
            )
            _easting = _k0 * _n * (
                _aa + (1 - _t + _c) * _aa ** 3 / 6
                + (5 - 18 * _t + _t ** 2 + 72 * _c - 58 * _ecc_prime_sq) * _aa ** 5 / 120
            ) + 500000
            _northing = _k0 * (
                _m + _n * _math.tan(_lat_rad) * (
                    _aa ** 2 / 2
                    + (5 - _t + 9 * _c + 4 * _c ** 2) * _aa ** 4 / 24
                    + (61 - 58 * _t + _t ** 2 + 600 * _c - 330 * _ecc_prime_sq) * _aa ** 6 / 720
                )
            )
            if lat < 0:
                _northing += 10000000
            return {"utm_zone": f"{_zone}{_hemisphere}", "utm_easting": _easting, "utm_northing": _northing}

        _utm_df = pl.DataFrame(
            [_latlon_to_utm(lat, lon) for lat, lon in _locations_table.select("latitude", "longitude").iter_rows()],
            schema={"utm_zone": pl.Utf8, "utm_easting": pl.Float64, "utm_northing": pl.Float64},
        )
        _locations_table = pl.concat([_locations_table.drop("latitude", "longitude"), _utm_df], how="horizontal")

    _coord_digits = coordinate_digits.value
    if _coord_digits is not None:
        _coord_cols = ["utm_easting", "utm_northing"] if coordinate_format.value == "utm" else ["latitude", "longitude"]
        if coordinate_method.value == "truncate":
            _scale = 10 ** _coord_digits

            def _truncate_coord(v):
                return int(v * _scale) / _scale

            _locations_table = _locations_table.with_columns(
                pl.col(_coord_cols[0]).map_elements(_truncate_coord, return_dtype=pl.Float64),
                pl.col(_coord_cols[1]).map_elements(_truncate_coord, return_dtype=pl.Float64),
            )
        else:
            _locations_table = _locations_table.with_columns(
                pl.col(_coord_cols[0]).round(_coord_digits),
                pl.col(_coord_cols[1]).round(_coord_digits),
            )
    if show_species_columns.value:
        _dep_to_loc = dict(_locations_raw.select("deployment_id", "location_id").iter_rows())
        _pat_result = __import__("re").compile(r"COMMONNAME:([^\]]+)")
        _species_by_loc = {}
        _years_by_loc = {}
        _months_by_loc = {}
        for _obs in observations_filtered.select("deployment_id", "timestamp", "scientific_name", "tags").iter_rows(named=True):
            _name = _obs["scientific_name"] or ""
            _loc_id = _dep_to_loc.get(_obs["deployment_id"])
            if not _loc_id:
                continue
            _names = [_name] if len(_name) >= 3 else _pat_result.findall(_obs["tags"] or "")
            for _n in _names:
                if _n:
                    _species_by_loc.setdefault(_loc_id, set()).add(_n)
            _ts = _obs["timestamp"] or ""
            if len(_ts) >= 4:
                _years_by_loc.setdefault(_loc_id, set()).add(_ts[:4])
            if len(_ts) >= 7:
                _months_by_loc.setdefault(_loc_id, set()).add(_ts[5:7])
        _summary_ids = set(_species_by_loc) | set(_years_by_loc) | set(_months_by_loc)
        _species_summary = pl.DataFrame(
            [
                {
                    "location_id": _loc_id,
                    "years": ", ".join(sorted(_years_by_loc.get(_loc_id, set()))),
                    "months": ", ".join(sorted(_months_by_loc.get(_loc_id, set()))),
                    "species": ", ".join(sorted(_species_by_loc.get(_loc_id, set()))),
                    "species_count": len(_species_by_loc.get(_loc_id, set())),
                }
                for _loc_id in _summary_ids
            ],
            schema={
                "location_id": pl.Utf8,
                "years": pl.Utf8,
                "months": pl.Utf8,
                "species": pl.Utf8,
                "species_count": pl.Int64,
            },
        )
        _locations_table = (
            _locations_table
            .join(_species_summary, on="location_id", how="left")
            .with_columns(
                pl.col("years").fill_null(""),
                pl.col("months").fill_null(""),
                pl.col("species").fill_null(""),
                pl.col("species_count").fill_null(0),
            )
        )

    # Human column labels for the Locations tab (E.5).
    _label_map = {
        "mountain_range": "Range",
        "location_id": "Site",
        "location_name": "Location",
        "latitude": "Latitude",
        "longitude": "Longitude",
        "utm_zone": "UTM zone",
        "utm_easting": "Easting",
        "utm_northing": "Northing",
        "elevation_m": "Elevation (m)",
        "elevation_ft": "Elevation (ft)",
        "image_count": "Images",
        "tagged_image_count": "Tagged",
        "years": "Years",
        "months": "Months",
        "species": "Species",
        "species_count": "# species",
    }
    _display = _locations_table.rename({k: v for k, v in _label_map.items() if k in _locations_table.columns})

    locations_table_view = mo.ui.table(
        _display,
        show_column_summaries=False,
        show_data_types=False,
        selection=None,
        pagination=True,
    )
    return locations, locations_table_view


@app.cell(hide_code=True)
def _(locations, observations_filtered, pl):
    # Pure-Python hexagonal binning (pointy-top axial grid). Replaces the `h3`
    # package, which is a compiled Cython extension with no Pyodide/wasm wheel —
    # `import h3` fails in the deployed WASM bundle. This keeps the same hex
    # geometry and `hex_summary`/`hex_geojson` schema with zero binary deps.
    import math as _hexmath

    # Edge length in degrees latitude (~3.3 km), comparable to H3 resolution 6.
    HEX_SIZE_DEG = 0.03
    _SQRT3 = _hexmath.sqrt(3.0)
    # Reference latitude to keep hexes visually regular on the map: projecting
    # longitude by cos(lat0) removes the meridian convergence, then the inverse
    # stretch restores it so cells read as hexagons at the data's latitude.
    _lat0 = float(locations["latitude"].mean()) if locations.height else 0.0
    _cos_lat0 = _hexmath.cos(_hexmath.radians(_lat0)) or 1.0

    def _latlng_to_cell(lat, lng):
        _x = lng * _cos_lat0
        _y = lat
        _qf = (_SQRT3 / 3.0 * _x - 1.0 / 3.0 * _y) / HEX_SIZE_DEG
        _rf = (2.0 / 3.0 * _y) / HEX_SIZE_DEG
        _xc, _zc = _qf, _rf
        _yc = -_xc - _zc
        _rx, _ry, _rz = round(_xc), round(_yc), round(_zc)
        _dx, _dy, _dz = abs(_rx - _xc), abs(_ry - _yc), abs(_rz - _zc)
        if _dx > _dy and _dx > _dz:
            _rx = -_ry - _rz
        elif _dy > _dz:
            _ry = -_rx - _rz
        else:
            _rz = -_rx - _ry
        return f"{int(_rx)}:{int(_rz)}"

    def _cell_to_ring(cid):
        _q_str, _r_str = cid.split(":")
        _q, _r = int(_q_str), int(_r_str)
        _cx = HEX_SIZE_DEG * (_SQRT3 * _q + _SQRT3 / 2.0 * _r)
        _cy = HEX_SIZE_DEG * (1.5 * _r)
        _ring = []
        for _i in range(6):
            _ang = _hexmath.radians(60 * _i - 30)
            _px = _cx + HEX_SIZE_DEG * _hexmath.cos(_ang)
            _py = _cy + HEX_SIZE_DEG * _hexmath.sin(_ang)
            _ring.append([_px / _cos_lat0, _py])
        _ring.append(_ring[0])
        return _ring

    if locations.height == 0:
        hex_geojson = {"type": "FeatureCollection", "features": []}
        hex_summary = pl.DataFrame(
            {
                "h3_id": [],
                "camera_count": [],
                "location_ids": [],
                "location_names": [],
                "center_lat": [],
                "center_lng": [],
                "species_richness": [],
                "checklists": [],
                "most_recent": [],
                "richness_per_camera": [],
            },
            schema={
                "h3_id": pl.Utf8,
                "camera_count": pl.Int64,
                "location_ids": pl.List(pl.Utf8),
                "location_names": pl.List(pl.Utf8),
                "center_lat": pl.Float64,
                "center_lng": pl.Float64,
                "species_richness": pl.Int64,
                "checklists": pl.Int64,
                "most_recent": pl.Utf8,
                "richness_per_camera": pl.Float64,
            },
        )
    else:
        _loc_with_hex = locations.with_columns(
            pl.struct(["latitude", "longitude"])
            .map_elements(
                lambda s: _latlng_to_cell(s["latitude"], s["longitude"]),
                return_dtype=pl.Utf8,
            )
            .alias("h3_id")
        )

        _dep_to_hex = {}
        for _row in _loc_with_hex.iter_rows(named=True):
            for _d in _row["deployment_ids"]:
                _dep_to_hex[_d] = _row["h3_id"]

        _obs_with_hex = observations_filtered.with_columns(
            pl.col("deployment_id").replace_strict(_dep_to_hex, default=None).alias("h3_id")
        ).filter(pl.col("h3_id").is_not_null())

        _obs_agg = (
            _obs_with_hex
            .group_by("h3_id")
            .agg(
                pl.col("scientific_name").filter(pl.col("scientific_name").str.len_chars() >= 3).n_unique().alias("species_richness"),
                pl.col("media_path").n_unique().alias("checklists"),
                pl.col("timestamp").max().alias("most_recent"),
            )
        )
        _cam_agg = (
            _loc_with_hex
            .group_by("h3_id")
            .agg(
                pl.col("location_id").n_unique().alias("camera_count"),
                pl.col("location_id").alias("location_ids"),
                pl.col("location_name").alias("location_names"),
                pl.col("latitude").mean().alias("center_lat"),
                pl.col("longitude").mean().alias("center_lng"),
            )
        )

        hex_summary = (
            _cam_agg
            .join(_obs_agg, on="h3_id", how="left")
            .with_columns(
                pl.col("species_richness").fill_null(0),
                pl.col("checklists").fill_null(0),
                (pl.col("species_richness") / pl.col("camera_count")).fill_nan(0.0).fill_null(0.0).alias("richness_per_camera"),
                pl.col("most_recent").fill_null("—"),
            )
            .sort("species_richness", descending=True)
        )

        def _to_polygon(hid):
            return _cell_to_ring(hid)

        hex_geojson = {
            "type": "FeatureCollection",
            "features": [
                {
                    "type": "Feature",
                    "id": _hid,
                    "properties": {"h3_id": _hid},
                    "geometry": {"type": "Polygon", "coordinates": [_to_polygon(_hid)]},
                }
                for _hid in hex_summary["h3_id"].to_list()
            ],
        }
    None
    return hex_geojson, hex_summary


@app.cell(hide_code=True)
def _(
    basemap_choice,
    hex_geojson,
    hex_summary,
    is_wildcats_s3_endpoint,
    locations,
    map_display_mode,
    mo,
):
    # Map. Hex cells for protected display, or exact site points for precise QA
    # (points only offered on the trusted wildcats endpoint). Basemap comes from a
    # marimo dropdown (E.6) rather than plotly updatemenus; uirevision keeps the
    # viewport across reactive rebuilds.
    import plotly.graph_objects as go
    _display_mode = map_display_mode.value if is_wildcats_s3_endpoint else "hex"

    if hex_summary.height == 0:
        camera_map = None
    else:
        _ids = hex_summary["h3_id"].to_list()
        _z = hex_summary["species_richness"].to_list()
        _cam = hex_summary["camera_count"].to_list()
        _check = hex_summary["checklists"].to_list()
        _recent = [str(x)[:10] for x in hex_summary["most_recent"].to_list()]
        _rpc = [round(x, 2) for x in hex_summary["richness_per_camera"].to_list()]
        _names_list = [", ".join(ns[:3]) + ("..." if len(ns) > 3 else "")
                       for ns in hex_summary["location_names"].to_list()]
        _customdata = list(zip(_ids, _cam, _check, _recent, _rpc, _names_list))
        _center_lats = hex_summary["center_lat"].to_list()
        _center_lngs = hex_summary["center_lng"].to_list()
        _earth_colors = [
            [0.00, "#f5ead6"],
            [0.20, "#d9c28c"],
            [0.45, "#a7a96b"],
            [0.70, "#8a6f3d"],
            [1.00, "#5f3b24"],
        ]
        _raster_sources = {
            "topo": dict(
                sourcetype="raster",
                source=["https://basemap.nationalmap.gov/arcgis/rest/services/USGSTopo/MapServer/tile/{z}/{y}/{x}"],
                below="traces",
            ),
            "imagery": dict(
                sourcetype="raster",
                source=["https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"],
                below="traces",
            ),
            "shaded_relief": dict(
                sourcetype="raster",
                source=["https://basemap.nationalmap.gov/arcgis/rest/services/USGSShadedReliefOnly/MapServer/tile/{z}/{y}/{x}"],
                below="traces",
            ),
            "shaded_relief_labels": dict(
                sourcetype="raster",
                source=["https://services.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}"],
            ),
            "shaded_relief_roads": dict(
                sourcetype="raster",
                source=["https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}"],
                opacity=0.55,
                below="traces",
            ),
            "stewardship": dict(
                sourcetype="raster",
                source=["https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}"],
                below="traces",
            ),
        }
        _basemaps = {
            "Topo": ("white-bg", [_raster_sources["topo"]]),
            "Imagery": ("white-bg", [_raster_sources["imagery"]]),
            "Shaded relief": (
                "white-bg",
                [
                    _raster_sources["shaded_relief"],
                    _raster_sources["shaded_relief_roads"],
                    _raster_sources["shaded_relief_labels"],
                ],
            ),
            "Stewardship": ("white-bg", [_raster_sources["stewardship"]]),
            "OpenStreetMap": ("open-street-map", []),
            "Light": ("carto-positron", []),
        }
        _map_style, _map_layers = _basemaps.get(basemap_choice.value, _basemaps["Topo"])

        if _display_mode == "points":
            _hex_lookup = {}
            for _r in hex_summary.iter_rows(named=True):
                for _lid in _r["location_ids"]:
                    _hex_lookup[_lid] = _r
            _point_rows = [
                {
                    "location_id": _r["location_id"],
                    "location_name": _r["location_name"],
                    "lat": _r["latitude"],
                    "lon": _r["longitude"],
                    "species_richness": _hex_lookup.get(_r["location_id"], {}).get("species_richness", 0),
                    "checklists": _hex_lookup.get(_r["location_id"], {}).get("checklists", 0),
                    "most_recent": _hex_lookup.get(_r["location_id"], {}).get("most_recent", "—"),
                }
                for _r in locations.iter_rows(named=True)
            ]
            camera_fig = go.Figure(
                go.Scattermap(
                    lat=[r["lat"] for r in _point_rows],
                    lon=[r["lon"] for r in _point_rows],
                    mode="markers",
                    marker=dict(size=14, color="#5f3b24", opacity=0.9),
                    customdata=[
                        (r["location_id"], r["location_name"], r["species_richness"], r["checklists"], r["most_recent"])
                        for r in _point_rows
                    ],
                    hovertemplate=(
                        "<b>%{customdata[1]}</b><br>"
                        "<b>Site</b>: %{customdata[0]}<br>"
                        "<b>Species richness</b>: %{customdata[2]}<br>"
                        "<b>Total observations</b>: %{customdata[3]}<br>"
                        "<b>Most recent</b>: %{customdata[4]}<extra></extra>"
                    ),
                )
            )
        else:
            camera_fig = go.Figure(
                go.Choroplethmap(
                    geojson=hex_geojson,
                    locations=_ids,
                    z=_z,
                    featureidkey="properties.h3_id",
                    colorscale=_earth_colors,
                    marker=dict(line=dict(color="rgba(54,43,25,0.9)", width=1.6), opacity=0.8),
                    selected=dict(marker=dict(opacity=0.95)),
                    unselected=dict(marker=dict(opacity=0.48)),
                    colorbar=dict(
                        title=dict(text="Species richness", side="right", font=dict(size=11)),
                        x=0.99,
                        xanchor="right",
                        y=0.5,
                        len=0.6,
                        thickness=9,
                        outlinewidth=0,
                        tickfont=dict(size=10),
                        bgcolor="rgba(251,247,235,0.75)",
                    ),
                    customdata=_customdata,
                    hovertemplate=(
                        "<b>Species richness</b>: %{z}<br>"
                        "<b>Number of cameras</b>: %{customdata[1]}<br>"
                        "<b>Total observations</b>: %{customdata[2]}<br>"
                        "<b>Most recent</b>: %{customdata[3]}<br>"
                        "<b>Richness per camera</b>: %{customdata[4]}<br>"
                        "<i>%{customdata[5]}</i><extra></extra>"
                    ),
                )
            )

        _center_lat = sum(_center_lats) / len(_center_lats)
        _center_lng = sum(_center_lngs) / len(_center_lngs)
        camera_fig.update_layout(
            map=dict(
                style=_map_style,
                layers=_map_layers,
                center=dict(lat=_center_lat, lon=_center_lng),
                zoom=7,
                uirevision="camera-map-view",
            ),
            margin=dict(l=0, r=0, t=0, b=0),
            height=520,
            showlegend=False,
            clickmode="event+select",
            dragmode="pan",
            uirevision="camera-map-view",
            paper_bgcolor="rgba(0,0,0,0)",
        )
        camera_map = mo.ui.plotly(camera_fig, config={"displayModeBar": False, "scrollZoom": True})

    None
    return (camera_map,)


@app.cell(hide_code=True)
def _(camera_map, hex_summary, is_wildcats_s3_endpoint, map_display_mode, pl):
    # Selection bridge for either hex cells or exact site points.
    _v = camera_map.value if (camera_map is not None and hasattr(camera_map, "value")) else []
    _display_mode = map_display_mode.value if is_wildcats_s3_endpoint else "hex"

    selected_location_ids = []
    if _v:
        if _display_mode == "points":
            _seen = set()
            for _p in _v:
                _cd = _p.get("customdata")
                if _cd:
                    _lid = _cd[0] if isinstance(_cd, (list, tuple)) else _cd
                    if _lid not in _seen:
                        _seen.add(_lid)
                        selected_location_ids.append(_lid)
        else:
            _hex_id_list = hex_summary["h3_id"].to_list()
            _hex_ids = []
            for _p in _v:
                _cd = _p.get("customdata")
                if _cd:
                    _hex_ids.append(_cd[0] if isinstance(_cd, (list, tuple)) else _cd)
                    continue
                _idx = _p.get("pointIndex")
                if _idx is None:
                    _idx = _p.get("pointNumber")
                if isinstance(_idx, int) and 0 <= _idx < len(_hex_id_list):
                    _hex_ids.append(_hex_id_list[_idx])
            _seen = set()
            for _r in hex_summary.filter(pl.col("h3_id").is_in(_hex_ids)).iter_rows(named=True):
                for _lid in _r["location_ids"]:
                    if _lid not in _seen:
                        _seen.add(_lid)
                        selected_location_ids.append(_lid)
    return (selected_location_ids,)


@app.cell(hide_code=True)
def _(
    hex_summary,
    locations,
    mo,
    observations_filtered,
    pl,
    selected_location_ids,
):
    # Persistent side dashboard next to the map: whole-collection summary before a
    # selection, selected-area richness/abundance after one. All colors are token-
    # driven (E.11).
    import html as _html
    import re as _re

    def _card_row(label, value):
        return (
            "<div class='sparcd-row'>"
            f"<span class='k'>{label}</span>"
            f"<span class='v'>{value}</span></div>"
        )

    def _small_note(text):
        return f"<div class='sparcd-note'>{text}</div>"

    def _bar_chart(species_counts, limit=6):
        if not species_counts:
            return "<div class='sparcd-note'>No species in current filters.</div>"
        _max_count = max(count for _, count in species_counts[:limit]) or 1
        _rows = []
        for _name, _count in species_counts[:limit]:
            _width = max(8, round((_count / _max_count) * 100))
            _safe_name = _html.escape(_name)
            _rows.append(
                "<div style='margin:6px 0;'>"
                "<div style='display:flex; justify-content:space-between; gap:8px; "
                "font-size:12px; color:var(--inkSoft);'>"
                f"<span style='overflow:hidden; text-overflow:ellipsis; white-space:nowrap;'>{_safe_name}</span>"
                f"<strong>{_count}</strong>"
                "</div>"
                "<div class='sparcd-bar-track'>"
                f"<div class='sparcd-bar-fill' style='width:{_width}%;'></div>"
                "</div>"
                "</div>"
            )
        return "".join(_rows)

    def _species_list(dep_ids):
        _obs = observations_filtered.filter(pl.col("deployment_id").is_in(dep_ids))
        _pat = _re.compile(r"COMMONNAME:([^\]]+)")
        _counts = {}
        for _row in _obs.select("tags", "media_path").iter_rows(named=True):
            _names = set(_pat.findall(_row["tags"] or ""))
            for _name in _names:
                _counts[_name] = _counts.get(_name, 0) + 1
        return sorted(_counts.items(), key=lambda kv: (-kv[1], kv[0].lower()))

    if selected_location_ids:
        _selected = locations.filter(pl.col("location_id").is_in(selected_location_ids))
        _dep_ids = [d for ds in _selected["deployment_ids"].to_list() for d in ds]
        _species = _species_list(_dep_ids)
        _species_rows = "".join(
            _card_row(_html.escape(name), count)
            for name, count in _species[:12]
        ) or "<div class='sparcd-note'>No species in current filters.</div>"
        _panel_title = "Selected area"
        _abundance = sum(count for _, count in _species)
        _chart = _bar_chart(_species)
        _summary = (
            _card_row("Sites", _selected.height)
            + _card_row("Images", int(_selected["image_count"].sum()))
            + _card_row("Tagged images", int(_selected["tagged_image_count"].sum()))
            + _card_row("Richness", len(_species))
            + _card_row("Abundance (detections)", _abundance)
        )
        _details = (
            _small_note("Richness is the number of unique species detected. "
                        "Abundance is the number of species detections in tagged images; "
                        "it is not a population estimate.")
            + "<div style='font-size:13px; font-weight:700; color:var(--ink); margin-top:10px;'>Abundance by species (detections)</div>"
            + _chart
        )
    else:
        _dep_ids = [d for ds in locations["deployment_ids"].to_list() for d in ds] if locations.height else []
        _species = _species_list(_dep_ids)
        _species_rows = "".join(
            _card_row(_html.escape(name), count)
            for name, count in _species[:10]
        ) or "<div class='sparcd-note'>No species in current filters.</div>"
        _panel_title = "Current map"
        _summary = (
            _card_row("Map cells", hex_summary.height)
            + _card_row("Sites", locations.height)
            + _card_row("Images", int(locations["image_count"].sum()) if locations.height else 0)
            + _card_row("Species", len(_species))
        )
        _details = _small_note("Click a hex or site point to see richness, abundance, and a species chart.")

    map_dashboard = mo.Html(
        "<div class='sparcd-card' style='min-width:170px;'>"
        f"<div class='title'>{_panel_title}</div>"
        f"{_summary}"
        f"{_details}"
        "<div style='font-size:13px; font-weight:700; color:var(--ink); margin-top:12px;'>Species detected</div>"
        f"{_species_rows}"
        "</div>"
    )
    None
    return (map_dashboard,)


@app.cell(hide_code=True)
def _(locations, mo, pl, selected_location_ids):
    # Selection headline, or a designed empty state prompting map interaction (E.7).
    if not selected_location_ids:
        selection_report = mo.Html(
            "<div class='sparcd-empty'>"
            "<div class='glyph'>🗺️</div>"
            "<div class='headline'>Select an area on the map to see its report</div>"
            "<div class='sub'>Click a hex cell, Shift-click to add more, or box-select a region. "
            "Its images, detections, and species appear below.</div>"
            "</div>"
        )
    else:
        from html import escape as _esc

        _rows = locations.filter(pl.col("location_id").is_in(selected_location_ids))
        _names = ", ".join(_esc(n) for n in _rows["location_name"].to_list())
        _img = int(_rows["image_count"].sum())
        _tag = int(_rows["tagged_image_count"].sum())
        selection_report = mo.Html(
            "<div class='sparcd-card'>"
            f"<div class='title'>{len(selected_location_ids)} location(s): {_names}</div>"
            f"<div class='sparcd-note'>{_img} image(s) · {_tag} tagged (after filters)</div>"
            "</div>"
        )
    return (selection_report,)


@app.cell(hide_code=True)
def _(
    applied_filters,
    locations,
    media_filtered,
    mo,
    observations_filtered,
    pl,
    selected_location_ids,
):
    from html import escape as _esc

    def _stats_html(loc, total, tagged, untagged, distinct, date_range_str, tagging_pct):
        def _row(label, value, tone="ink"):
            _color = {"ink": "var(--ink)", "ok": "var(--ok)", "warn": "var(--warn)", "mute": "var(--inkMute)"}[tone]
            return ("<div class='sparcd-row'>"
                    f"<span class='k'>{_esc(label)}</span>"
                    f"<span class='v' style='color:{_color};'>{_esc(str(value))}</span></div>")
        return (
            "<div>"
            + _row("Total images", total)
            + _row("Tagged", f"{tagged}  ({tagging_pct})", tone="ok")
            + _row("Untagged", untagged, tone="warn" if untagged else "mute")
            + _row("Distinct species", distinct)
            + _row("Date range", date_range_str)
            + "</div>"
        )

    def _table_rows_html(df, label_col):
        rows = []
        for r in df.iter_rows(named=True):
            rows.append(
                f"<tr><td style='padding:3px 8px 3px 0; color:var(--ink);'>{_esc(str(r[label_col]))}</td>"
                f"<td style='padding:3px 0; text-align:right; font-variant-numeric:tabular-nums; color:var(--inkSoft);'>{r['images']}</td></tr>"
            )
        return "<table style='width:100%; border-collapse:collapse; font-size:13px;'>" + "".join(rows) + "</table>"

    def _build_section(title, df, label_col, max_rows=8):
        header = mo.md(f"**{title}**")
        if df.height == 0:
            return mo.vstack([header, mo.Html("<span style='color:var(--inkMute);'>none</span>")])
        if df.height <= max_rows:
            return mo.vstack([header, mo.Html(_table_rows_html(df, label_col))])
        top_html = _table_rows_html(df.head(max_rows), label_col)
        rest_html = _table_rows_html(df.slice(max_rows, df.height - max_rows), label_col)
        label = f"Show {df.height - max_rows} more"
        return mo.vstack([
            header,
            mo.Html(top_html),
            mo.accordion({label: mo.Html(rest_html)}),
        ])

    if not selected_location_ids:
        location_summary_card = mo.md("")
    else:
        _rows = locations.filter(pl.col("location_id").is_in(selected_location_ids))
        _dep_ids = [d for ds in _rows["deployment_ids"].to_list() for d in ds]
        _media_loc = media_filtered.filter(pl.col("deployment_id").is_in(_dep_ids)).unique("media_path")
        _obs_loc = observations_filtered.filter(pl.col("deployment_id").is_in(_dep_ids))

        _total = _media_loc.height
        _tagged = _obs_loc["media_path"].unique().len()
        _untagged = max(0, _total - _tagged)

        _sci_clean = (
            _obs_loc
            .filter(pl.col("scientific_name").str.len_chars() >= 3)
            .filter(pl.col("scientific_name") != "")
        )
        _species_counts = (
            _sci_clean.group_by("scientific_name").len()
            .rename({"len": "images"}).sort("images", descending=True)
        )
        _distinct_species = _species_counts.height

        import re as _re_card
        _pat_card = _re_card.compile(r"COMMONNAME:([^\]]+)")
        _cn_counts = {}
        for _t in _obs_loc["tags"].to_list():
            if not _t:
                continue
            for _m in _pat_card.findall(_t):
                _cn_counts[_m] = _cn_counts.get(_m, 0) + 1
        _common_counts = (
            pl.DataFrame({"common_name": list(_cn_counts.keys()), "images": list(_cn_counts.values())})
            .sort("images", descending=True)
        )

        _dates = _obs_loc.filter(pl.col("timestamp").str.len_chars() >= 10)["timestamp"]
        _date_range_str = "—"
        if _dates.len() > 0:
            _d_min = _dates.min()[:10]
            _d_max = _dates.max()[:10]
            _date_range_str = f"{_d_min} → {_d_max}" if _d_min != _d_max else _d_min
        _tagging_pct = f"{(_tagged / _total * 100):.0f}%" if _total else "—"

        _stats_section = mo.vstack([
            mo.md("**Overview**"),
            mo.Html(_stats_html(_rows, _total, _tagged, _untagged, _distinct_species, _date_range_str, _tagging_pct)),
        ])
        _common_section = _build_section("Top common names", _common_counts, "common_name")
        _species_section = _build_section("Top species (scientific)", _species_counts, "scientific_name")

        _filter_notes = []
        if applied_filters["exclude"]:
            _filter_notes.append(f"excluding: <i>{_esc(', '.join(applied_filters['exclude']))}</i>")
        _filter_notes.append(f"date: {applied_filters['date_start']} → {applied_filters['date_end']}")
        _filter_notes.append(f"{len(selected_location_ids)} location(s) selected")
        _notes = mo.Html("<div class='sparcd-note'>" + " · ".join(_filter_notes) + "</div>")

        location_summary_card = mo.vstack([
            mo.hstack(
                [_stats_section, _common_section, _species_section],
                widths="equal",
                gap=2,
                align="start",
            ),
            _notes,
        ])
    return (location_summary_card,)


@app.cell(hide_code=True)
def _(
    locations,
    media_filtered,
    observations_filtered,
    pl,
    selected_location_ids,
):
    # Per-image events for the selected area: one row per (bucket, media_path),
    # species aggregated across that image's observations. Untagged frames stay in
    # media_filtered but the inner join keeps only tagged images in the grid/table.
    if not selected_location_ids:
        selected_images_all = pl.DataFrame()
        selected_total = 0
    else:
        _rows = locations.filter(pl.col("location_id").is_in(selected_location_ids))
        _dep_ids = [d for ds in _rows["deployment_ids"].to_list() for d in ds]
        _dep_locations = pl.DataFrame([
            {
                "deployment_id": d,
                "mountain_range": r["mountain_range"],
                "location_id": r["location_id"],
                "location_name": r["location_name"],
            }
            for r in _rows.iter_rows(named=True)
            for d in r["deployment_ids"]
        ])
        _selected_media = (
            media_filtered
            .filter(pl.col("deployment_id").is_in(_dep_ids))
            .select("media_path", "file_name", "deployment_id", "bucket")
            .unique(subset=["bucket", "media_path"])
            .join(_dep_locations, on="deployment_id", how="left")
        )
        _selected_keys = set(_selected_media.select("bucket", "media_path").iter_rows())
        import re as _re_events
        _common_pat = _re_events.compile(r"COMMONNAME:([^\]]+)")
        _events_by_key = {}
        for _obs in observations_filtered.iter_rows(named=True):
            _key = (_obs["bucket"], _obs["media_path"])
            if _key not in _selected_keys:
                continue
            _name = _obs["scientific_name"] or ""
            _tags = _obs["tags"] or ""
            _names = [_name] if len(_name) >= 3 else _common_pat.findall(_tags)
            _event = _events_by_key.setdefault(
                _key,
                {"bucket": _key[0], "media_path": _key[1], "species": set(), "count": 0, "tags": "", "timestamp": ""},
            )
            _event["species"].update(n for n in _names if n)
            try:
                _event["count"] += int(_obs["count"] or 0)
            except ValueError:
                pass
            if not _event["tags"] and _tags:
                _event["tags"] = _tags
            _ts = _obs["timestamp"] or ""
            if _ts and (not _event["timestamp"] or _ts < _event["timestamp"]):
                _event["timestamp"] = _ts
        _obs_events = pl.DataFrame(
            [
                {
                    "bucket": _event["bucket"],
                    "media_path": _event["media_path"],
                    "scientific_name": ", ".join(sorted(_event["species"])),
                    "count": _event["count"],
                    "tags": _event["tags"],
                    "timestamp": _event["timestamp"],
                }
                for _event in _events_by_key.values()
            ],
            schema={
                "bucket": pl.Utf8,
                "media_path": pl.Utf8,
                "scientific_name": pl.Utf8,
                "count": pl.Int64,
                "tags": pl.Utf8,
                "timestamp": pl.Utf8,
            },
        )
        selected_images_all = (
            _selected_media
            .join(
                _obs_events,
                on=["bucket", "media_path"],
                how="inner",
            )
            .sort("timestamp", descending=False)
        )
        selected_total = selected_images_all.height
    None
    return selected_images_all, selected_total


@app.cell(hide_code=True)
def _(mo):
    # Thumbnail pagination state (E.9): prev/next buttons over mo.state instead of
    # a page dropdown. PAGE_SIZE thumbnails per page.
    PAGE_SIZE = 20
    get_page, set_page = mo.state(1)
    return PAGE_SIZE, get_page, set_page


@app.cell(hide_code=True)
def _(selected_location_ids, set_page):
    # Reset to page 1 whenever the map selection changes.
    selected_location_ids
    set_page(1)
    return


@app.cell(hide_code=True)
def _(PAGE_SIZE, get_page, mo, selected_total, set_page):
    # Prev/next controls + "Page N of M". Clamp so out-of-range state self-corrects.
    _total_pages = max(1, -(-selected_total // PAGE_SIZE))
    _page = min(max(1, get_page()), _total_pages)

    _prev = mo.ui.button(
        label="‹ Prev",
        disabled=_page <= 1,
        on_change=lambda _v, p=_page: set_page(max(1, p - 1)),
    )
    _next = mo.ui.button(
        label="Next ›",
        disabled=_page >= _total_pages,
        on_change=lambda _v, p=_page: set_page(min(_total_pages, p + 1)),
    )
    page_controls = mo.hstack(
        [_prev, mo.md(f"**Page {_page} of {_total_pages}**"), _next],
        justify="start",
        align="center",
        gap=1,
    )
    current_page = _page
    return current_page, page_controls


@app.cell(hide_code=True)
def _(
    PAGE_SIZE,
    client,
    current_page,
    mo,
    page_controls,
    selected_images_all,
    selected_location_ids,
    selected_total,
):
    from datetime import timedelta
    from html import escape

    def _presign_row(bucket: str, path: str) -> str:
        return client.presigned_get_object(bucket, path, expires=timedelta(minutes=30))

    def _parse_tags(raw: str) -> str:
        if not raw:
            return ""
        parts = [p.split(":", 1)[1] for p in raw.strip("[]").split("][") if ":" in p]
        return ", ".join(parts)

    if not selected_location_ids:
        thumbnail_grid = mo.Html(
            "<div class='sparcd-note'>Select an area on the map to browse its images.</div>"
        )
    elif selected_total == 0:
        thumbnail_grid = mo.Html(
            "<div class='sparcd-note'>No tagged images match the current filters at the selected location(s).</div>"
        )
    else:
        _page = current_page
        _start = (_page - 1) * PAGE_SIZE
        _end = min(_start + PAGE_SIZE, selected_total)
        _page_df = selected_images_all.slice(_start, PAGE_SIZE)

        # Critical layout is ALSO inlined on every element, not only carried by the
        # .sparcd-grid rules in THEME_CSS. Style attributes survive verbatim into any
        # web-component shadow root, so the grid renders as a real grid even where an
        # adopted stylesheet might not reach (belt-and-suspenders for the title fix,
        # and deterministic in the WASM export). aspect-ratio reserves each tile's box
        # up front so lazily-decoded images cause no layout shift; the paper-tone
        # background is the placeholder shown until each image paints. var() fallbacks
        # keep the tones even if the custom properties don't inherit into the shadow.
        _grid_style = (
            "display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));"
            "gap:12px;margin-top:0.5rem;"
        )
        _fig_style = "margin:0;display:flex;flex-direction:column;gap:4px;"
        _img_style = (
            "width:100%;aspect-ratio:4/3;object-fit:cover;display:block;"
            "background:var(--mark,#ead8a3);border:1px solid var(--ruleSoft,#cfc4a8);"
        )
        _tiles = []
        for _row in _page_df.iter_rows(named=True):
            _url = _presign_row(_row["bucket"], _row["media_path"])
            _tag = _parse_tags(_row.get("tags") or "")
            _sci = _row.get("scientific_name") or ""
            _ts = (_row.get("timestamp") or "").replace("T", " ")[:19]
            _caption = " · ".join(x for x in [_tag, _sci, _ts] if x)
            _u = escape(_url, quote=True)
            _f = escape(_row["file_name"])
            _m = escape(_caption) if _caption else "&nbsp;"
            _tiles.append(
                f"<figure style='{_fig_style}'>"
                f"<a href='{_u}' target='_blank' rel='noopener' title='Open full image' style='display:block; cursor:zoom-in;'>"
                f"<img src='{_u}' loading='lazy' decoding='async' style='{_img_style}' /></a>"
                "<figcaption style='font-size:12px;line-height:1.3;'>"
                f"<div class='fname' style='font-weight:600;color:var(--ink,#1c1a14);'>{_f}</div>"
                f"<div class='caption' style='color:var(--inkMute,#6b6555);word-break:break-word;'>{_m}</div>"
                "</figcaption>"
                "</figure>"
            )
        _grid = f"<div class='sparcd-grid' style='{_grid_style}'>" + "".join(_tiles) + "</div>"
        _caption_line = mo.Html(
            f"<div class='sparcd-note'>Images {_start + 1}–{_end} of {selected_total} (tagged only). "
            "Click a thumbnail to open the full image in a new tab.</div>"
        )
        thumbnail_grid = mo.vstack([page_controls, _caption_line, mo.Html(_grid)])

    None
    return (thumbnail_grid,)


@app.cell(hide_code=True)
def _(mo, selected_images_all, selected_location_ids):
    # Detection/event table sub-filter (post-selection, live-reactive).
    show_image_event_table = mo.ui.checkbox(
        value=True,
        label="Show each selected image file as a table row",
    )
    _species_options = []
    if selected_location_ids and selected_images_all.height > 0:
        _seen = set()
        for _value in selected_images_all["scientific_name"].to_list():
            for _name in [p.strip() for p in (_value or "").split(",") if p.strip()]:
                if _name not in _seen:
                    _seen.add(_name)
                    _species_options.append(_name)
    detection_species_filter = mo.ui.multiselect(
        options=sorted(_species_options),
        value=[],
        label="Detection table species filter (empty = all detected species)",
        full_width=True,
    )
    return detection_species_filter, show_image_event_table


@app.cell(hide_code=True)
def _(
    detection_species_filter,
    mo,
    selected_location_ids,
    show_image_event_table,
):
    if selected_location_ids and show_image_event_table.value:
        detection_table_controls = mo.vstack([
            show_image_event_table,
            detection_species_filter,
        ])
    elif selected_location_ids:
        detection_table_controls = show_image_event_table
    else:
        detection_table_controls = mo.md("")
    return (detection_table_controls,)


@app.cell(hide_code=True)
def _(
    detection_species_filter,
    mo,
    pl,
    selected_images_all,
    selected_location_ids,
    selected_total,
    show_image_event_table,
):
    if not selected_location_ids:
        image_event_table = mo.Html(
            "<div class='sparcd-note'>Select an area on the map to list its detections.</div>"
        )
    elif not show_image_event_table.value:
        image_event_table = mo.md("")
    elif selected_total == 0:
        image_event_table = mo.Html(
            "<div class='sparcd-note'>No tagged image events match the current filters at the selected location(s).</div>"
        )
    else:
        _selected_species = set(detection_species_filter.value or [])
        _filtered_images = selected_images_all
        if _selected_species:
            _mask = [
                bool({p.strip() for p in (value or "").split(",") if p.strip()} & _selected_species)
                for value in selected_images_all["scientific_name"].to_list()
            ]
            _filtered_images = selected_images_all.filter(pl.Series("_species_keep", _mask))
        _event_rows = (
            _filtered_images
            .select(
                "timestamp",
                "mountain_range",
                "location_id",
                "location_name",
                "file_name",
                "scientific_name",
                "count",
                "media_path",
                "deployment_id",
            )
            .rename({
                "timestamp": "Timestamp",
                "mountain_range": "Range",
                "location_id": "Site",
                "location_name": "Location",
                "file_name": "File",
                "scientific_name": "Species",
                "count": "Animal count",
                "media_path": "Media path",
                "deployment_id": "Deployment",
            })
        )
        if _event_rows.height == 0:
            image_event_table = mo.Html(
                "<div class='sparcd-note'>No image events match the selected species filter.</div>"
            )
        else:
            image_event_table = mo.ui.table(
                _event_rows,
                show_column_summaries=False,
                show_data_types=False,
                selection=None,
                pagination=True,
            )
    return (image_event_table,)


@app.cell(hide_code=True)
def _(applied_filters, locations, mo, observations_filtered):
    # Stat row (E.4): Sites, Images, Tagged %, Species — respecting current search.
    # Replaces every debug string.
    import re as _re_stat

    _sites = locations.height
    _images = int(locations["image_count"].sum()) if locations.height else 0
    _tagged = int(locations["tagged_image_count"].sum()) if locations.height else 0
    _tagged_pct = f"{(_tagged / _images * 100):.0f}%" if _images else "—"

    # Species = distinct common-name tags, matching the map dashboard's count.
    # (Do not also union scientific_name — that's a separate namespace and would
    # double-count any observation carrying both.)
    _pat = _re_stat.compile(r"COMMONNAME:([^\]]+)")
    _species = set()
    for _t in observations_filtered["tags"].to_list():
        if _t:
            _species.update(_pat.findall(_t))

    _span = f"{applied_filters['date_start']} → {applied_filters['date_end']}"

    # Own markup instead of mo.stat: <marimo-stat> renders inside a shadow root
    # that never adopts this page's <style>, so THEME_CSS can't restyle it.
    def _stat_card(label, value, caption=""):
        return (
            "<div class='sparcd-stat'>"
            f"<div class='label'>{label}</div>"
            f"<div class='value'>{value}</div>"
            f"<div class='caption'>{caption or '&nbsp;'}</div>"
            "</div>"
        )

    stat_row = mo.Html(
        "<div class='sparcd-stats'>"
        + _stat_card("Sites", f"{_sites}")
        + _stat_card("Images", f"{_images:,}", f"{_tagged:,} tagged")
        + _stat_card("Tagged", _tagged_pct, f"{_tagged:,} of {_images:,}")
        + _stat_card("Species", f"{len(_species)}", _span)
        + "</div>"
    )
    stat_row
    return


@app.cell(hide_code=True)
def _(
    basemap_choice,
    camera_map,
    detection_table_controls,
    image_event_table,
    location_summary_card,
    locations_table_view,
    map_dashboard,
    mo,
    selection_report,
    thumbnail_grid,
):
    # Map + side dashboard, then the drill-in tabs (E.5). The empty-state /
    # selection report sits under the map; per-area detail lives in the tabs.
    # The basemap dropdown rides above the map (E.6) — a real marimo control, not
    # plotly updatemenus; uirevision keeps the viewport across its reactive rebuild.
    _map_block = camera_map if camera_map is not None else mo.Html(
        "<div class='sparcd-empty'><div class='glyph'>🗺️</div>"
        "<div class='headline'>No locations to display</div>"
        "<div class='sub'>No camera sites match the current filters. Widen the search to see the map.</div></div>"
    )
    _map_toolbar = mo.hstack([basemap_choice], justify="end") if camera_map is not None else mo.md("")
    # Themed tile-credit line, replacing plotly/maplibre's built-in attribution
    # (which escaped the map box). Text tracks the active basemap dropdown value.
    _basemap_credits = {
        "Topo": "USGS The National Map",
        "Imagery": "Esri World Imagery",
        "Shaded relief": "USGS 3DEP Shaded Relief · Esri",
        "Stewardship": "Esri World Topographic Map",
        "OpenStreetMap": "© OpenStreetMap contributors",
        "Light": "© OpenStreetMap contributors · © CARTO",
    }
    _map_credit = mo.Html(
        "<div class='sparcd-map-credit'>Tiles · "
        f"{_basemap_credits.get(basemap_choice.value, 'USGS / Esri')}</div>"
    ) if camera_map is not None else mo.md("")
    _map_row = mo.hstack(
        [mo.vstack([_map_toolbar, _map_block, _map_credit, selection_report], gap=1), map_dashboard],
        widths=[5, 1],
        align="start",
    )

    _images_tab = mo.vstack([thumbnail_grid])
    _detections_tab = mo.vstack([detection_table_controls, image_event_table, location_summary_card])
    _locations_tab = mo.vstack([locations_table_view])

    _tabs = mo.ui.tabs({
        "Images": _images_tab,
        "Detections": _detections_tab,
        "Locations": _locations_tab,
    })
    mo.vstack([_map_row, _tabs])
    return


if __name__ == "__main__":
    app.run()
