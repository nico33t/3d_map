import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from './components/ui/select';

// Preserve the imperative map's select contract while rendering the official React UI.
const controls = new Map<HTMLSelectElement, { draw: () => void; dispose: () => void }>();
let nextId = 0;
export function syncSelect(select: HTMLSelectElement) { controls.get(select)?.draw(); }
export function disposeSelectsWithin(container: ParentNode) {
  for (const [select, control] of controls) if (container.contains(select)) control.dispose();
}
export function mountSelect(select: HTMLSelectElement) {
  if (controls.has(select)) return;
  const host = document.createElement('span'); host.className = 'select-host';
  select.after(host);
  const root = createRoot(host);
  const triggerId = `${select.id || `fleet-select-${++nextId}`}-trigger`;
  const labels = [...select.labels ?? []];
  const labelText = select.getAttribute('aria-label') || labels.map(label => label.textContent?.trim()).join(' ') || 'Seleziona';
  const originalFor = labels.map(label => label.htmlFor);
  labels.forEach(label => { label.htmlFor = triggerId; });
  select.hidden = true; select.setAttribute('aria-hidden', 'true');
  const dialog = select.closest('dialog');
  let disposed = false;
  let open = false;
  const draw = () => {
    if (disposed) return;
    const options = [...select.options].filter(option => option.value !== '');
    root.render(<Select open={open} onOpenChange={value => { open = value; draw(); }} value={select.value} disabled={select.disabled} onValueChange={value => {
      select.value = value;
      select.dispatchEvent(new Event('change', { bubbles: true }));
      draw();
    }}>
      <SelectTrigger id={triggerId} aria-label={labelText} className="w-full"><SelectValue placeholder="Seleziona…" /></SelectTrigger>
      <SelectContent onEscapeKeyDown={event => { event.preventDefault(); open = false; draw(); }} position="popper" align="start" container={dialog ?? undefined}>
        <SelectGroup>{options.map(option => <SelectItem key={option.value} value={option.value} disabled={option.disabled}>{option.text}</SelectItem>)}</SelectGroup>
      </SelectContent>
    </Select>);
  };
  const observer = new MutationObserver(draw);
  observer.observe(select, { childList: true, subtree: true, attributes: true, characterData: true, attributeFilter: ['disabled', 'selected', 'label', 'value'] });
  select.addEventListener('change', draw);
  controls.set(select, { draw, dispose() {
    disposed = true; observer.disconnect(); select.removeEventListener('change', draw);
    root.unmount(); host.remove(); controls.delete(select);
    select.hidden = false; select.removeAttribute('aria-hidden');
    labels.forEach((label, index) => { label.htmlFor = originalFor[index] ?? ''; });
  } });
  flushSync(draw);
}
