/** In-app text entry, including Electron where window.prompt is unsupported. */
export function requestText(message: string, initialValue = ''): Promise<string | null> {
  if (document.querySelector('[data-perdepro-prompt]')) return Promise.resolve(null);
  return new Promise((resolve) => {
    const previousFocus = document.activeElement as HTMLElement | null;
    const dialog = document.createElement('dialog');
    dialog.dataset.perdeproPrompt = 'true';
    dialog.style.cssText = 'border:0;border-radius:18px;padding:24px;width:min(480px,90vw);max-height:85vh;overflow:auto;margin:auto;color:#0f172a;background:white;box-shadow:0 24px 80px #0005';
    dialog.setAttribute('aria-labelledby', 'perdepro-prompt-label');
    const form = document.createElement('form');
    form.method = 'dialog';
    const label = document.createElement('label');
    label.id = 'perdepro-prompt-label';
    label.htmlFor = 'perdepro-prompt-input';
    label.textContent = message;
    label.style.cssText = 'display:block;white-space:pre-wrap;line-height:1.5;margin-bottom:16px';
    const input = document.createElement('input');
    input.id = 'perdepro-prompt-input';
    input.type = 'text';
    input.value = initialValue;
    input.style.cssText = 'box-sizing:border-box;width:100%;padding:12px;border:1px solid #94a3b8;border-radius:8px;font-size:16px';
    const actions = document.createElement('div');
    actions.style.cssText = 'display:flex;gap:12px;justify-content:flex-end;margin-top:20px';
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.textContent = 'Vazgeç';
    const submit = document.createElement('button');
    submit.type = 'submit';
    submit.textContent = 'Onayla';
    for (const button of [cancel, submit]) button.style.cssText = 'padding:12px 20px;border-radius:8px;border:1px solid #cbd5e1;cursor:pointer;font-weight:600';
    submit.style.background = '#1d4ed8';
    submit.style.color = 'white';
    let completed = false;
    const finish = (value: string | null) => {
      if (completed) return;
      completed = true;
      dialog.close();
      dialog.remove();
      previousFocus?.focus();
      resolve(value);
    };
    cancel.onclick = () => finish(null);
    dialog.addEventListener('cancel', (event) => { event.preventDefault(); finish(null); });
    dialog.addEventListener('close', () => finish(null));
    form.onsubmit = (event) => { event.preventDefault(); finish(input.value); };
    actions.append(cancel, submit);
    form.append(label, input, actions);
    dialog.append(form);
    document.body.append(dialog);
    dialog.showModal();
    input.focus();
    input.select();
  });
}
