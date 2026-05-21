# Token and base URL persistence.
#
# Per the user's choice (see roadmap), tokens live in ~/.Renviron as
# `ASTROZOR_TOKEN=ast_pat_…`. The base URL likewise is `ASTROZOR_BASE_URL`
# (default https://astrozor.cz). Both can be set programmatically; the
# write helper appends to .Renviron and reloads the env var so the value
# is usable in the same R session without a restart.

.astrozor_renviron_path <- function() {
  # Per-user .Renviron — RStudio loads this on startup; we follow the
  # same convention so manual edits and `astrozor_set_token()` agree.
  path <- Sys.getenv("R_ENVIRON_USER", unset = "")
  if (nzchar(path)) return(path)
  file.path(Sys.getenv("HOME", unset = path.expand("~")), ".Renviron")
}

.astrozor_set_env <- function(key, value) {
  path <- .astrozor_renviron_path()
  lines <- character(0)
  if (file.exists(path)) {
    lines <- readLines(path, warn = FALSE)
  }
  # Strip any existing line for this key (idempotent updates).
  pattern <- paste0("^", gsub("([.|()\\^{}+$*?])", "\\\\\\1", key), "\\s*=")
  lines <- lines[!grepl(pattern, lines)]
  lines <- c(lines, sprintf('%s=%s', key, value))
  writeLines(lines, path)
  # Apply to current session so the user doesn't have to restart R.
  args <- setNames(list(value), key)
  do.call(Sys.setenv, args)
  invisible(value)
}

#' Set the Astrozor base URL (default: https://astrozor.cz)
#'
#' Persisted to ~/.Renviron as ASTROZOR_BASE_URL. Useful for pointing
#' the addin at a local dev instance ("http://localhost") without
#' touching the token.
#' @param url Full URL — scheme included, no trailing slash.
#' @export
astrozor_set_base_url <- function(url) {
  stopifnot(is.character(url), length(url) == 1, nzchar(url))
  .astrozor_set_env("ASTROZOR_BASE_URL", sub("/$", "", url))
}

#' Get the configured Astrozor base URL.
#' @export
astrozor_get_base_url <- function() {
  url <- Sys.getenv("ASTROZOR_BASE_URL", unset = "")
  if (!nzchar(url)) url <- "https://astrozor.cz"
  sub("/$", "", url)
}

#' Set the Astrozor API token (persisted to ~/.Renviron)
#'
#' Tokens are created in Astrozor's Settings → API tokens section. Store
#' once with this helper; subsequent `astrozor_publish()` / addin calls
#' pick the value up automatically. Token format is `ast_pat_…`.
#' @param token Plaintext token as displayed at creation time.
#' @export
astrozor_set_token <- function(token) {
  stopifnot(is.character(token), length(token) == 1, nzchar(token))
  .astrozor_set_env("ASTROZOR_TOKEN", token)
}

#' Get the configured Astrozor API token, or NA if unset.
#' @export
astrozor_get_token <- function() {
  v <- Sys.getenv("ASTROZOR_TOKEN", unset = "")
  if (!nzchar(v)) NA_character_ else v
}

#' Sanity check — call /publish/whoami with the stored token.
#'
#' Returns a list with the authenticated user's email + token name on
#' success, or stops with a helpful message on auth failure.
#' @export
astrozor_whoami <- function() {
  tok <- astrozor_get_token()
  if (is.na(tok)) {
    cli::cli_abort(c(
      "x" = "No ASTROZOR_TOKEN found.",
      "i" = "Set one with {.run astrozor_set_token('ast_pat_...')}."
    ))
  }
  base <- astrozor_get_base_url()
  req <- httr2::request(paste0(base, "/api/v1/publish/whoami")) |>
    httr2::req_headers(Authorization = paste("Bearer", tok)) |>
    httr2::req_error(is_error = function(resp) FALSE)
  resp <- httr2::req_perform(req)
  if (httr2::resp_status(resp) == 401L) {
    cli::cli_abort("Token rejected by {base}. Generate a fresh one and run {.run astrozor_set_token()}.")
  }
  if (httr2::resp_status(resp) >= 400L) {
    cli::cli_abort("Astrozor returned status {httr2::resp_status(resp)}.")
  }
  httr2::resp_body_json(resp)
}
