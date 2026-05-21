/**
 * astrozorpub JupyterLab extension — adds a "Publish to Astrozor"
 * toolbar button to every notebook panel.
 *
 * On click:
 *   1. POST {} to /astrozorpub/status to confirm a token is configured.
 *   2. Show a dialog pre-filled with title (notebook stem) + slug
 *      (slugified filename) + summary (empty).
 *   3. On submit, POST the form to /astrozorpub/publish — the server
 *      extension drives the existing astrozorpub.publish() pipeline
 *      (nbconvert render → bundle → multipart upload to Astrozor).
 *
 * Auth: handled by the underlying ServerConnection — Lab already
 * speaks to the Jupyter server with the user's token, so we don't
 * touch credentials here. The Astrozor token itself stays on the
 * Jupyter host (~/.astrozor/config.json) and never reaches the
 * browser.
 */

import {
  JupyterFrontEnd,
  JupyterFrontEndPlugin
} from '@jupyterlab/application';
import {
  Dialog,
  ICommandPalette,
  showDialog,
  ToolbarButton
} from '@jupyterlab/apputils';
import {
  INotebookTracker,
  NotebookPanel
} from '@jupyterlab/notebook';
import { ServerConnection } from '@jupyterlab/services';
import { Widget } from '@lumino/widgets';

import { URLExt } from '@jupyterlab/coreutils';

const PLUGIN_ID = 'astrozorpub-labextension:plugin';
const COMMAND_PUBLISH = 'astrozorpub:publish';

interface StatusResponse {
  base_url: string;
  has_token: boolean;
  token_prefix: string;
}

interface PublishResponse {
  article_slug?: string;
  url?: string;
  doi?: string | null;
  error?: string;
  trace?: string;
}

/** Hit a relative path under the configured Jupyter server, returning
 *  the parsed JSON body. Bubbles up the server error message when the
 *  response isn't 2xx so the caller can show it in the dialog. */
async function serverFetch<T>(
  path: string,
  init: RequestInit = {}
): Promise<T> {
  const settings = ServerConnection.makeSettings();
  const url = URLExt.join(settings.baseUrl, path);
  const response = await ServerConnection.makeRequest(url, init, settings);
  if (!response.ok) {
    let detail = response.statusText;
    try {
      const j = (await response.json()) as { error?: string };
      if (j?.error) detail = j.error;
    } catch {
      /* fallthrough to statusText */
    }
    throw new Error(`HTTP ${response.status}: ${detail}`);
  }
  return (await response.json()) as T;
}

/** Slug helper mirroring the Python ``_slug_from_path`` so the
 *  pre-filled value matches what the server would default to if the
 *  user submits an empty slug. */
function slugFromFilename(name: string): string {
  const stem = name.replace(/\.ipynb$/i, '').toLowerCase();
  return stem
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 120);
}

/** Dialog body — a small form with title / slug / summary inputs.
 *  We extend ``Widget`` and expose ``getValue`` so the showDialog
 *  helper can read the result. */
class PublishDialogBody extends Widget {
  constructor(initial: {
    title: string;
    slug: string;
    summary: string;
    baseUrl: string;
    hasToken: boolean;
  }) {
    const node = document.createElement('div');
    node.classList.add('jp-astrozor-dialog');
    node.innerHTML = `
      <p class="jp-astrozor-hint">
        Cíl: <strong>${escapeHtml(initial.baseUrl)}</strong>
        ${initial.hasToken ? '' : ' · <span style="color:#f87171">⚠ chybí token</span>'}
      </p>
      <label for="ast-title">Název článku</label>
      <input id="ast-title" type="text" value="${escapeHtml(initial.title)}" />
      <label for="ast-slug">Slug (URL)</label>
      <input id="ast-slug" type="text" value="${escapeHtml(initial.slug)}" />
      <p class="jp-astrozor-hint">Stejný slug = update existujícího článku.</p>
      <label for="ast-summary">Krátký popis (volitelný)</label>
      <textarea id="ast-summary" rows="3"></textarea>
      <label for="ast-theme">Téma</label>
      <select id="ast-theme">
        <option value="dark" selected>Dark (Astrozor)</option>
        <option value="light">Light (nbconvert default)</option>
        <option value="none">Beze změny</option>
      </select>
      <label style="margin-top:10px;display:flex;align-items:center;gap:6px">
        <input id="ast-execute" type="checkbox" />
        <span>Před exportem znovu spustit všechny buňky</span>
      </label>
    `;
    super({ node });
  }

  getValue(): {
    title: string;
    slug: string;
    summary: string;
    theme: string;
    execute: boolean;
  } {
    const get = (id: string): string =>
      (this.node.querySelector('#' + id) as HTMLInputElement | null)?.value ??
      '';
    const exec =
      (this.node.querySelector('#ast-execute') as HTMLInputElement | null)
        ?.checked ?? false;
    return {
      title: get('ast-title').trim(),
      slug: get('ast-slug').trim(),
      summary: get('ast-summary').trim(),
      theme: get('ast-theme') || 'dark',
      execute: exec
    };
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Run the publish flow for the given notebook panel. */
async function publishPanel(panel: NotebookPanel): Promise<void> {
  // Save first so the on-disk file matches what we'll render. Without
  // this we'd publish a stale version after the user added cells but
  // didn't ⌘S.
  await panel.context.save();

  const notebookPath = panel.context.path;
  const filename = notebookPath.split('/').pop() ?? 'notebook.ipynb';

  let status: StatusResponse;
  try {
    status = await serverFetch<StatusResponse>('astrozorpub/status');
  } catch (e) {
    await showDialog({
      title: 'Astrozor — server extension nedostupný',
      body:
        'Server extension se nenačetl. Zkontroluj, že jsi nainstaloval ' +
        '`pip install astrozorpub` ve stejném prostředí, ve kterém běží ' +
        'Jupyter, a restartuj server.\n\n' +
        String(e),
      buttons: [Dialog.okButton()]
    });
    return;
  }

  if (!status.has_token) {
    await showDialog({
      title: 'Astrozor — chybí token',
      body:
        'Není uložený přístupový token. V terminálu spusť:\n\n' +
        '    astrozorpub set-token ast_pat_xxxxxxxxxxxx\n\n' +
        'Token najdeš v Astrozoru: Settings → API tokeny.\n\n' +
        'Aktuální base URL: ' + status.base_url,
      buttons: [Dialog.okButton()]
    });
    return;
  }

  const body = new PublishDialogBody({
    title: filename.replace(/\.ipynb$/i, ''),
    slug: slugFromFilename(filename),
    summary: '',
    baseUrl: status.base_url,
    hasToken: status.has_token
  });

  const result = await showDialog<{
    title: string;
    slug: string;
    summary: string;
    theme: string;
    execute: boolean;
  }>({
    title: 'Publikovat na Astrozor',
    body,
    buttons: [
      Dialog.cancelButton({ label: 'Zrušit' }),
      Dialog.okButton({ label: 'Publikovat' })
    ]
  });

  if (!result.button.accept || !result.value) return;
  const form = result.value;
  if (!form.title) {
    await showDialog({
      title: 'Astrozor',
      body: 'Název článku je povinný.',
      buttons: [Dialog.okButton()]
    });
    return;
  }

  // Publishing is sync on the server side (it renders + uploads
  // before responding) — can take a while for big notebooks. Show a
  // simple "publishing…" busy dialog the user can't accidentally
  // dismiss until we have a result.
  const busy = showDialog({
    title: 'Publikuji…',
    body: 'Render → bundle → upload na Astrozor. Vydrž chvíli.',
    buttons: []
  });

  let resp: PublishResponse;
  try {
    resp = await serverFetch<PublishResponse>('astrozorpub/publish', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        notebook_path: notebookPath,
        title: form.title,
        slug: form.slug || undefined,
        summary: form.summary,
        theme: form.theme,
        execute: form.execute
      })
    });
  } catch (e) {
    void busy; // showDialog without buttons resolves on its own next tick
    await showDialog({
      title: 'Astrozor — publish selhal',
      body: String(e),
      buttons: [Dialog.okButton()]
    });
    return;
  }

  void busy;
  if (resp.error) {
    await showDialog({
      title: 'Astrozor — chyba',
      body: resp.error,
      buttons: [Dialog.okButton()]
    });
    return;
  }

  const url = (status.base_url || '') + (resp.url || '');
  await showDialog({
    title: 'Astrozor — hotovo ✅',
    body:
      `Slug: ${resp.article_slug ?? '?'}\n` +
      (resp.doi ? `DOI:  ${resp.doi}\n` : '') +
      `\n${url}`,
    buttons: [Dialog.okButton({ label: 'OK' })]
  });
}

const plugin: JupyterFrontEndPlugin<void> = {
  id: PLUGIN_ID,
  autoStart: true,
  requires: [INotebookTracker],
  optional: [ICommandPalette],
  activate: (
    app: JupyterFrontEnd,
    tracker: INotebookTracker,
    palette: ICommandPalette | null
  ) => {
    app.commands.addCommand(COMMAND_PUBLISH, {
      label: 'Publish to Astrozor',
      caption: 'Render the notebook and publish it to the Astrozor instance.',
      iconLabel: 'A',
      isEnabled: () => tracker.currentWidget !== null,
      execute: async () => {
        const current = tracker.currentWidget;
        if (!current) return;
        await publishPanel(current);
      }
    });

    if (palette) {
      palette.addItem({ command: COMMAND_PUBLISH, category: 'Astrozor' });
    }

    // Add a toolbar button to every notebook panel as it opens.
    tracker.widgetAdded.connect((_t, panel) => {
      const button = new ToolbarButton({
        className: 'jp-astrozor-publish-button',
        label: '🔭 Publish',
        tooltip: 'Publish to Astrozor',
        onClick: () => {
          void publishPanel(panel);
        }
      });
      // Insert near the right of the toolbar but before the kernel
      // status — the kernel widgets are pinned at the end.
      panel.toolbar.insertItem(10, 'astrozorPublish', button);
    });
  }
};

export default plugin;
