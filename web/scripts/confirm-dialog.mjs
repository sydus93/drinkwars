// DW-079: the pre-submit "Before you submit" check is an in-app dialog now (it was window.confirm).
// The audits used to accept it with page.on("dialog") and assert on its text; this is the drop-in:
// call it once per page, before the first navigation, and it logs the dialog's text through
// `onText` (push it under the same "[tag dialog]" prefix) and presses "Submit anyway".
export async function autoConfirm(page, onText) {
  await page.exposeFunction("__dwConfirmSeen", (t) => onText(String(t)));
  await page.evaluateOnNewDocument(() => {
    const seen = new WeakSet();
    const scan = () => {
      const d = document.querySelector('[data-dw="submit-confirm"]');
      if (!d || seen.has(d)) return;
      seen.add(d);
      window.__dwConfirmSeen(d.innerText);
      setTimeout(() => d.querySelector('[data-dw="submit-confirm-go"]')?.click(), 0);
    };
    new MutationObserver(scan).observe(document, { childList: true, subtree: true });
  });
}
