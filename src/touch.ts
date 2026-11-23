import type { Direction } from './engine.js';

export function touchInput(pad: HTMLElement, bomb: HTMLButtonElement, enabled: () => boolean,
  turn: (direction: Direction) => void, plant: () => void, changed: () => void) {
  const keys = Array.from(pad.querySelectorAll<HTMLButtonElement>('[data-direction]'));
  const pointers = new Map<number, Direction | undefined>();
  let pressedTimer = 0;

  function paint() {
    const held = new Set(pointers.values());
    for (const key of keys) key.classList.toggle('held', held.has(key.dataset.direction as Direction));
  }

  function aim(event: PointerEvent) {
    const box = pad.getBoundingClientRect();
    const x = event.clientX - box.left - box.width / 2;
    const y = event.clientY - box.top - box.height / 2;
    const reach = Math.max(Math.abs(x), Math.abs(y));
    const previous = pointers.get(event.pointerId);
    let direction: Direction | undefined;
    if (reach > (previous ? 8 : 12) && reach <= box.width / 2 + (previous ? 28 : 16)) {
      direction = Math.abs(x) > Math.abs(y) ? (x < 0 ? 'left' : 'right') : (y < 0 ? 'up' : 'down');
      // Keep a held direction near the diagonal until the new axis clearly wins.
      if (previous && previous !== direction) {
        const along = previous === 'left' ? -x : previous === 'right' ? x : previous === 'up' ? -y : y;
        if (along > 0 && reach - along < Math.min(10, reach * .22)) direction = previous;
      }
    }
    if (pointers.has(event.pointerId) && pointers.get(event.pointerId) === direction) return;
    pointers.delete(event.pointerId);
    pointers.set(event.pointerId, direction);
    if (direction) turn(direction);
    changed();
    paint();
  }

  pad.addEventListener('pointerdown', event => {
    if (event.button !== 0 || !enabled()) return;
    event.preventDefault();
    pad.setPointerCapture(event.pointerId);
    aim(event);
  });
  pad.addEventListener('pointermove', event => {
    if (pointers.has(event.pointerId)) aim(event);
  });
  for (const name of ['pointerup', 'pointercancel', 'lostpointercapture'] as const) {
    pad.addEventListener(name, event => {
      if (pointers.delete(event.pointerId)) {
        changed();
        paint();
      }
    });
  }
  for (const key of keys) key.addEventListener('click', event => {
    if (event.detail === 0 && enabled()) {
      turn(key.dataset.direction as Direction);
      changed();
    }
  });

  function pressBomb() {
    bomb.classList.add('pressed');
    window.clearTimeout(pressedTimer);
    pressedTimer = window.setTimeout(() => bomb.classList.remove('pressed'), 100);
    plant();
    changed();
  }
  bomb.addEventListener('pointerdown', event => {
    if (event.button !== 0 || !enabled()) return;
    event.preventDefault();
    pressBomb();
  });
  bomb.addEventListener('click', event => {
    if (event.detail === 0 && enabled()) pressBomb();
  });

  return {
    held: () => Array.from(pointers.values()).reverse().filter((direction): direction is Direction => direction !== undefined),
    clear() {
      const captured = Array.from(pointers.keys());
      pointers.clear();
      window.clearTimeout(pressedTimer);
      bomb.classList.remove('pressed');
      for (const id of captured) if (pad.hasPointerCapture(id)) pad.releasePointerCapture(id);
      paint();
    }
  };
}
