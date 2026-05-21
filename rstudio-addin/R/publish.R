# Core publish pipeline:
#   1. If given a .qmd/.Rmd, render it (Quarto for .qmd; rmarkdown for .Rmd).
#   2. Locate the rendered HTML directory and ZIP it.
#   3. POST the ZIP + manifest fields to /api/publish/quarto.

#' Bundle a rendered HTML output directory into a ZIP for Astrozor.
#'
#' Given the path to either an `index.html` (or any `.html` we'll rename
#' to index.html in the zip) or the directory containing it, produce a
#' temp ZIP whose root contains `index.html` plus any sibling files
#' (typically `<doc>_files/` with figures, JS, CSS). This matches what
#' Astrozor's /publish/quarto endpoint expects.
#'
#' @param html_path Path to the rendered .html (or its parent dir).
#' @return Path to the temporary .zip file. Caller is responsible for
#'   cleanup, but `tempfile()` paths are removed at session end anyway.
#' @export
astrozor_bundle <- function(html_path) {
  html_path <- normalizePath(html_path, mustWork = TRUE)
  if (dir.exists(html_path)) {
    src_dir <- html_path
    index_candidates <- list.files(src_dir, pattern = "\\.html$", full.names = TRUE)
    if (length(index_candidates) == 0L) {
      cli::cli_abort("No .html file found in {.path {src_dir}}.")
    }
    # Prefer `index.html` if present, else the first .html.
    idx <- index_candidates[basename(index_candidates) == "index.html"]
    if (length(idx) == 0L) idx <- index_candidates[1L]
    index_file <- idx
  } else {
    src_dir <- dirname(html_path)
    index_file <- html_path
  }

  # Stage everything in a fresh temp dir so the zip root has exactly
  # `index.html` + assets — no enclosing directory.
  stage <- tempfile("astrozor_bundle_")
  dir.create(stage)
  on.exit(unlink(stage, recursive = TRUE), add = TRUE)

  # Copy the html as `index.html` (renaming if necessary).
  file.copy(index_file, file.path(stage, "index.html"), overwrite = TRUE)

  # Copy sibling asset directories that look like Quarto/Rmd outputs.
  # Heuristic: any sibling dir with the same stem suffixed `_files/`
  # OR `libs/` (Quarto default), OR `figures/`.
  stem <- tools::file_path_sans_ext(basename(index_file))
  candidate_dirs <- c(
    file.path(src_dir, paste0(stem, "_files")),
    file.path(src_dir, "libs"),
    file.path(src_dir, "figures"),
    file.path(src_dir, "site_libs")
  )
  for (d in candidate_dirs) {
    if (dir.exists(d)) {
      file.copy(d, stage, recursive = TRUE)
    }
  }

  # Also copy any sibling .css/.js/.png/.svg/.jpg next to the HTML —
  # users sometimes embed standalone assets without a _files dir.
  for (ext in c("css", "js", "png", "svg", "jpg", "jpeg", "gif", "webp")) {
    matches <- list.files(src_dir, pattern = paste0("\\.", ext, "$"), full.names = TRUE)
    for (m in matches) file.copy(m, stage, overwrite = TRUE)
  }

  zip_path <- tempfile("astrozor_bundle_", fileext = ".zip")
  # Use the `zip` CRAN package — pure-C, no Rtools / external `zip.exe`
  # required. `utils::zip()` shells out to a system binary and fails
  # silently on Windows without Rtools, leaving callers with a missing
  # zip file. The `zip::zip()` API takes `root` so we don't need a
  # setwd dance.
  files <- list.files(stage, recursive = TRUE, all.files = FALSE)
  if (length(files) == 0L) {
    cli::cli_abort("Nothing to bundle in {.path {stage}} — no HTML output detected.")
  }
  zip::zip(zipfile = zip_path, files = files, root = stage)
  if (!file.exists(zip_path) || file.info(zip_path)$size < 100) {
    cli::cli_abort("Bundle write failed at {.path {zip_path}}.")
  }
  zip_path
}

# Theme overrides applied at render time. Quarto's --metadata-file is a
# proper merge (not replace), so the user keeps everything they had in
# the YAML frontmatter except the explicit keys we override here.
# Bootswatch `darkly` ships with Quarto out of the box — it pairs well
# with Astrozor's slate-900 background; we further force the page bg
# to match Astrozor exactly so the iframe blends seamlessly into the
# article detail view.
.astrozor_theme_presets <- list(
  dark = list(
    quarto_metadata = list(
      format = list(
        html = list(
          theme = "darkly",
          backgroundcolor = "#0f172a",   # slate-900 — matches Astrozor
          fontcolor = "#e2e8f0",         # slate-200
          linkcolor = "#818cf8",         # indigo-400
          mainfont = "system-ui, -apple-system, 'Segoe UI', sans-serif"
        )
      )
    ),
    rmd_output_options = list(theme = "darkly")
  ),
  light = list(
    quarto_metadata = list(
      format = list(html = list(theme = "cosmo"))
    ),
    rmd_output_options = list(theme = "cosmo")
  ),
  none = list(quarto_metadata = NULL, rmd_output_options = NULL)
)

#' Publish a rendered (or to-be-rendered) Quarto / RMarkdown document.
#'
#' If `file` is a `.qmd` or `.Rmd` and `render = TRUE`, the document is
#' rendered to HTML first (using `quarto::quarto_render` or
#' `rmarkdown::render`). If `file` is already an `.html`, it's bundled
#' directly. Either way the resulting bundle is POSTed to
#' `/api/publish/quarto`.
#'
#' Idempotent: re-running with the same `slug` updates the previously
#' published article in place.
#'
#' @param file Path to .qmd, .Rmd, or .html.
#' @param title Article title (defaults to the document title from YAML
#'   frontmatter, falling back to the filename stem).
#' @param slug URL slug. If NULL, derived from `title` server-side.
#' @param summary Short description shown on the article list.
#' @param language ISO code, default "cs".
#' @param render Whether to render .qmd/.Rmd (TRUE) or assume already
#'   rendered (FALSE — bundle the existing .html).
#' @param theme One of `"dark"` (default, matches Astrozor),
#'   `"light"`, or `"none"` (use whatever theme the YAML frontmatter
#'   says). Ignored when `file` is already an .html (we can't
#'   re-theme a rendered bundle).
#' @param published_via Analytics tag, default "rstudio".
#' @return List with `article_slug`, `url`, `asset_url`.
#' @export
astrozor_publish <- function(
  file,
  title = NULL,
  slug = NULL,
  summary = "",
  language = "cs",
  render = TRUE,
  theme = c("dark", "light", "none"),
  published_via = "rstudio"
) {
  theme <- match.arg(theme)
  tok <- astrozor_get_token()
  if (is.na(tok)) {
    cli::cli_abort(c(
      "x" = "No ASTROZOR_TOKEN configured.",
      "i" = "Set it once with {.run astrozor_set_token('ast_pat_...')}."
    ))
  }
  base <- astrozor_get_base_url()

  file <- normalizePath(file, mustWork = TRUE)
  ext <- tolower(tools::file_ext(file))

  # Try to lift a sensible default title from YAML frontmatter if the
  # caller didn't pass one. Cheap regex — no need for a full YAML parser
  # because we only want the `title:` line of the header.
  if (is.null(title)) {
    title <- .read_frontmatter_title(file)
    if (is.null(title) || !nzchar(title)) {
      title <- tools::file_path_sans_ext(basename(file))
    }
  }

  html_path <- if (ext %in% c("qmd", "rmd") && isTRUE(render)) {
    .render_doc(file, ext, theme = theme)
  } else if (ext == "html") {
    file
  } else if (ext %in% c("qmd", "rmd") && !isTRUE(render)) {
    # User passed source path but said don't render — locate the
    # already-rendered html next to the source.
    candidate <- file.path(
      dirname(file),
      paste0(tools::file_path_sans_ext(basename(file)), ".html")
    )
    if (!file.exists(candidate)) {
      cli::cli_abort("Expected rendered HTML at {.path {candidate}}; pass render = TRUE or render manually first.")
    }
    candidate
  } else {
    cli::cli_abort("Unsupported file extension: {.val {ext}}. Pass .qmd, .Rmd, or .html.")
  }

  zip_path <- astrozor_bundle(html_path)

  engine <- if (ext == "rmd") "rmarkdown" else "quarto"
  req <- httr2::request(paste0(base, "/api/v1/publish/quarto")) |>
    httr2::req_headers(Authorization = paste("Bearer", tok)) |>
    httr2::req_body_multipart(
      bundle  = curl::form_file(zip_path, type = "application/zip"),
      title   = title,
      slug    = slug %||% "",
      summary = summary,
      language = language,
      engine = engine,
      published_via = published_via
    ) |>
    httr2::req_error(is_error = function(resp) FALSE)
  resp <- httr2::req_perform(req)
  status <- httr2::resp_status(resp)
  body <- tryCatch(httr2::resp_body_json(resp), error = function(e) list(detail = httr2::resp_body_string(resp)))

  if (status == 401L) {
    cli::cli_abort("Token rejected by {base}. Generate a fresh one in Settings → API tokeny.")
  }
  if (status == 507L) {
    cli::cli_abort("Storage quota exceeded on {base}: {body$detail}")
  }
  if (status >= 400L) {
    cli::cli_abort("Publish failed ({status}): {body$detail %||% 'unknown error'}")
  }

  cli::cli_alert_success("Published: {base}{body$url}")
  invisible(body)
}

`%||%` <- function(a, b) if (is.null(a) || (is.character(a) && !nzchar(a))) b else a

.render_doc <- function(path, ext, theme = "dark") {
  preset <- .astrozor_theme_presets[[theme]] %||% .astrozor_theme_presets$none

  # Refuse Shiny runtime documents BEFORE invoking render — they are
  # live R server apps, not static HTML, and rmarkdown::render() would
  # either start a Shiny server (instead of producing a file) or fail
  # opaquely. Easier to detect from YAML than to interpret the failure.
  runtime <- .read_frontmatter_value(path, "runtime")
  if (!is.null(runtime) && grepl("shiny", runtime, ignore.case = TRUE)) {
    cli::cli_abort(c(
      "x" = "Tento dokument má {.code runtime: {runtime}} — je to {.strong Shiny aplikace}, ne statický článek.",
      "i" = "Astrozor publikuje pre-rendered HTML bundle. Shiny dokumenty potřebují běžící R server (shinyapps.io, Posit Connect, vlastní hosting).",
      "i" = "Pro statickou prezentaci ulož jako {.code .qmd} (revealjs) nebo {.code .Rmd} bez Shiny runtime — zkus odstranit/zakomentovat řádek {.code runtime:} v YAML."
    ))
  }

  output_path <- if (ext == "qmd") {
    if (!requireNamespace("quarto", quietly = TRUE)) {
      cli::cli_abort("Package {.pkg quarto} is required to render .qmd files. Install with {.run install.packages('quarto')}.")
    }
    if (!is.null(preset$quarto_metadata)) {
      # `metadata` is serialized to a temp YAML and passed via
      # --metadata-file, which Quarto MERGES with the file's frontmatter
      # (our keys win on conflicts). User's other YAML (toc, fig-cap,
      # author, etc.) survives intact.
      quarto::quarto_render(path, quiet = TRUE, metadata = preset$quarto_metadata)
    } else {
      quarto::quarto_render(path, quiet = TRUE)
    }
    # quarto_render doesn't return the output path — fall back to the
    # conventional location (same dir, same stem, .html). Users with
    # custom `output-dir` in _quarto.yml will need to handle bundling
    # manually for now.
    file.path(
      dirname(path),
      paste0(tools::file_path_sans_ext(basename(path)), ".html")
    )
  } else {
    if (!requireNamespace("rmarkdown", quietly = TRUE)) {
      cli::cli_abort("Package {.pkg rmarkdown} is required to render .Rmd files.")
    }
    # rmarkdown::render() RETURNS the absolute path of the output file
    # — use it directly so our code handles custom `output_dir`,
    # filenames with spaces, format-specific suffixes (e.g. presentations),
    # all without guessing.
    if (!is.null(preset$rmd_output_options)) {
      rmarkdown::render(path, quiet = TRUE, output_options = preset$rmd_output_options)
    } else {
      rmarkdown::render(path, quiet = TRUE)
    }
  }

  if (!file.exists(output_path)) {
    cli::cli_abort(c(
      "x" = "Render proběhl, ale výstupní HTML soubor neexistuje na očekávané cestě.",
      "i" = "Hledáno: {.path {output_path}}",
      "i" = "Možné příčiny: {.code output_dir} v YAML mimo složku zdroje, custom {.code output_file}, nebo render selhal tiše. Zkus {.code rmarkdown::render(\"{path}\")} ručně a podívej se kam HTML padlo."
    ))
  }
  output_path
}

.read_frontmatter_title <- function(path) .read_frontmatter_value(path, "title")

# Read a single top-level YAML key from the frontmatter (e.g. `title`,
# `runtime`). Only handles flat keys on the first column — nested keys
# like `output.html_document.theme` are out of scope. Returns NULL when
# the file has no frontmatter or the key isn't present.
.read_frontmatter_value <- function(path, key) {
  lines <- tryCatch(readLines(path, n = 60, warn = FALSE), error = function(e) character(0))
  if (length(lines) == 0L) return(NULL)
  if (!grepl("^---\\s*$", lines[1L])) return(NULL)
  end_idx <- which(grepl("^---\\s*$", lines))[2L]
  if (is.na(end_idx)) return(NULL)
  block <- lines[2L:(end_idx - 1L)]
  # Only top-level keys — leading whitespace would mean nested.
  pattern <- paste0("^", gsub("([.|()\\^{}+$*?])", "\\\\\\1", key), "\\s*:")
  hit <- grep(pattern, block, value = TRUE)
  if (length(hit) == 0L) return(NULL)
  val <- sub(paste0("^\\s*", key, "\\s*:\\s*"), "", hit[1L])
  val <- gsub('^["\']|["\']$', "", trimws(val))
  if (nzchar(val)) val else NULL
}
