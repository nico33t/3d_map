import { mountSelect, disposeSelectsWithin } from './ui-selects';
import { createRoot, type Root } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { Button, buttonVariants } from './components/ui/button';
import { ToggleGroup, ToggleGroupItem } from './components/ui/toggle-group';

interface Item { id: string; label: string; pressed: boolean; disabled: boolean }
interface Group { root: Root; label: string; multiple: boolean; items: Item[] }
const groups = new Map<string, Group>();
const roots: Root[] = [];
function drawGroup(group: Group) {
  const children = group.items.map(item => <ToggleGroupItem key={item.id} id={item.id} value={item.id} disabled={item.disabled} className="flex-1">{item.label}</ToggleGroupItem>);
  const common = { variant: 'outline' as const, className: 'w-full', 'aria-label': group.label };
  const selected = group.items.filter(item => item.pressed).map(item => item.id);
  group.root.render(group.multiple
    ? <ToggleGroup {...common} type="multiple" value={selected} onValueChange={() => {}}>{children}</ToggleGroup>
    : <ToggleGroup {...common} type="single" value={selected[0] ?? ''} onValueChange={() => {}}>{children}</ToggleGroup>);
}
export function setControlPressed(id: string, pressed: boolean) {
  const group = groups.get(id);
  if (group) { group.items.find(item => item.id === id)!.pressed = pressed; drawGroup(group); }
  else document.getElementById(id)?.setAttribute('aria-pressed', String(pressed));
}
export function setControlDisabled(id: string, disabled: boolean) {
  const group = groups.get(id);
  if (group) { group.items.find(item => item.id === id)!.disabled = disabled; drawGroup(group); }
  else { const button = document.getElementById(id) as HTMLButtonElement | null; if (button) button.disabled = disabled; }
}
/** React islands keep actual shadcn controls independent of the map's frame loop. */
export function mountShadcnControls() {
  for (const container of document.querySelectorAll<HTMLElement>('.environment')) {
    const label = container.getAttribute('aria-label') ?? '';
    const group: Group = { root: createRoot(container), label, multiple: label === 'Meteo', items: [...container.querySelectorAll('button')].map(button => ({ id: button.id, label: button.textContent ?? '', pressed: button.getAttribute('aria-pressed') === 'true', disabled: button.disabled })) };
    group.items.forEach(item => groups.set(item.id, group)); roots.push(group.root);
    flushSync(() => drawGroup(group));
  }
  for (const original of [...document.querySelectorAll<HTMLButtonElement>('button')]) {
    if (groups.has(original.id)) continue;
    const host = document.createElement('span'); host.style.display = 'contents';
    const attributes = Object.fromEntries([...original.attributes].filter(attribute => !['class', 'disabled', 'type'].includes(attribute.name)).map(attribute => [attribute.name, attribute.value]));
    const className = original.className;
    original.replaceWith(host);
    const root = createRoot(host); roots.push(root);
    flushSync(() => root.render(<Button {...attributes} type="button" variant={original.id === 'pause' ? 'default' : 'outline'} size={original.id === 'close-panel' ? 'icon' : 'default'} className={className} disabled={original.disabled}>{original.textContent}</Button>));
  }
  document.querySelectorAll<HTMLSelectElement>('select').forEach(mountSelect);
  return () => { disposeSelectsWithin(document); roots.forEach(root => root.unmount()); roots.length = 0; groups.clear(); };
}
/** Fleet rows are native DOM; share the official Button variant classes. */
export function styleFleetButton(button: HTMLButtonElement) {
  button.dataset.slot = 'button'; button.className = buttonVariants({ variant: 'outline', size: 'sm' });
}
