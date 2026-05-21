# RStudio addin entry point. Picks up the currently-edited document
# from `rstudioapi`, derives sensible defaults (title from YAML,
# slug from filename), and lets the user confirm before publishing.

#' @keywords internal
.guess_slug <- function(filename) {
  base <- tools::file_path_sans_ext(basename(filename))
  base <- tolower(base)
  base <- gsub("[^a-z0-9-]+", "-", base)
  base <- gsub("-+", "-", base)
  base <- gsub("^-|-$", "", base)
  substr(base, 1L, 120L)
}

#' Launch the Publish to Astrozor dialog.
#'
#' Invoked from RStudio Addins menu. Opens a small Shiny gadget pre-
#' filled with the current document's path, title (from YAML) and slug
#' (from filename). On Publish, renders if needed and POSTs to the
#' configured Astrozor instance.
#' @export
astrozor_publish_addin <- function() {
  if (!requireNamespace("rstudioapi", quietly = TRUE) ||
      !rstudioapi::isAvailable()) {
    cli::cli_abort("This addin must be run from inside RStudio.")
  }
  ctx <- rstudioapi::getSourceEditorContext()
  if (is.null(ctx) || !nzchar(ctx$path)) {
    cli::cli_abort("Save the document first — the addin needs a path on disk.")
  }
  doc_path <- ctx$path

  default_title <- .read_frontmatter_title(doc_path) %||% tools::file_path_sans_ext(basename(doc_path))
  default_slug <- .guess_slug(doc_path)
  current_base <- astrozor_get_base_url()
  has_token <- !is.na(astrozor_get_token())

  # Pre-flight: detect runtime:shiny (or shiny_prerendered) — these are
  # live R server apps, not static documents. We refuse them upfront so
  # the user doesn't waste time on a render that won't produce HTML.
  runtime_kind <- tryCatch(.read_frontmatter_value(doc_path, "runtime"),
                           error = function(e) NULL)
  is_shiny_doc <- !is.null(runtime_kind) &&
                  grepl("shiny", runtime_kind, ignore.case = TRUE)

  ui <- miniUI::miniPage(
    miniUI::gadgetTitleBar("Publikovat na Astrozor"),
    miniUI::miniContentPanel(
      shiny::tags$style(shiny::HTML(
        ".form-group { margin-bottom: 10px; }
         .astrozor-hint { color: #888; font-size: 11px; margin-top: -6px; margin-bottom: 6px; }"
      )),
      shiny::div(
        class = "astrozor-hint",
        sprintf("Cíl: %s%s", current_base,
                if (!has_token) " · ⚠ chybí ASTROZOR_TOKEN" else "")
      ),
      if (is_shiny_doc) {
        shiny::tags$div(
          style = paste(
            "background:#7f1d1d;color:#fecaca;border:1px solid #b91c1c;",
            "border-radius:6px;padding:8px 10px;margin-bottom:10px;font-size:12px;"
          ),
          shiny::tags$strong("⚠ Shiny dokument nelze publikovat staticky."),
          shiny::tags$br(),
          sprintf("YAML obsahuje runtime: %s — Astrozor publikuje pre-rendered HTML, ", runtime_kind),
          "ale Shiny apps potřebují běžící R server (shinyapps.io, Posit Connect, …). ",
          shiny::tags$br(),
          "Pro statickou prezentaci odstraň/zakomentuj řádek ",
          shiny::tags$code("runtime:"), " v YAML, nebo použij ",
          shiny::tags$code(".qmd"), " (revealjs)."
        )
      },
      shiny::textInput("title", "Název článku", value = default_title, width = "100%"),
      shiny::textInput("slug", "Slug (URL)", value = default_slug, width = "100%"),
      shiny::tags$div(class = "astrozor-hint",
                      "Stejný slug = update existujícího článku."),
      shiny::textAreaInput("summary", "Krátký popis (volitelný)", value = "",
                           rows = 2, width = "100%"),
      shiny::selectInput("language", "Jazyk", choices = c("cs", "en"),
                         selected = "cs", width = "30%"),
      shiny::selectInput(
        "theme",
        "Téma vykreslení",
        choices = c(
          "Tmavé (Astrozor design)" = "dark",
          "Světlé"                   = "light",
          "Beze změny (zachovat z YAML)" = "none"
        ),
        selected = "dark",
        width = "70%"
      ),
      shiny::tags$div(
        class = "astrozor-hint",
        "Astrozor je vždy tmavá aplikace. Světlé téma vsadí kontrastní článek; ",
        "„Beze změny“ použije theme z tvého YAML frontmatteru."
      ),
      shiny::checkboxInput("render", "Renderovat před publikací (Quarto/RMarkdown)",
                           value = TRUE),
      shiny::hr(),
      shiny::verbatimTextOutput("status", placeholder = TRUE)
    )
  )

  server <- function(input, output, session) {
    output$status <- shiny::renderText({
      if (is_shiny_doc) "Publikace zablokována — viz červené upozornění nahoře." else ""
    })

    shiny::observeEvent(input$done, {
      if (is_shiny_doc) {
        output$status <- shiny::renderText(
          "Tento dokument má runtime: shiny — nelze publikovat staticky. Odstraň runtime: z YAML."
        )
        return()
      }
      shiny::withProgress(message = "Publikuji…", value = 0.5, {
        result <- tryCatch(
          astrozor_publish(
            file = doc_path,
            title = input$title,
            slug = input$slug,
            summary = input$summary,
            language = input$language,
            render = isTRUE(input$render),
            theme = input$theme %||% "dark",
            published_via = "rstudio"
          ),
          error = function(e) e
        )
      })
      if (inherits(result, "error")) {
        output$status <- shiny::renderText(conditionMessage(result))
        return()
      }
      url <- paste0(astrozor_get_base_url(), result$url)
      output$status <- shiny::renderText(paste0("✓ Publikováno: ", url))
      # Briefly let the success message render, then close.
      Sys.sleep(0.7)
      shiny::stopApp(invisible(result))
    })

    shiny::observeEvent(input$cancel, {
      shiny::stopApp(invisible(NULL))
    })
  }

  # Sized to fit all fields (title, slug+hint, summary, lang, theme+hint,
  # render, status) without an inner scrollbar on default RStudio chrome.
  # If you add more fields, bump these.
  viewer <- shiny::dialogViewer("Publikovat na Astrozor", width = 620, height = 760)
  shiny::runGadget(ui, server, viewer = viewer)
}
