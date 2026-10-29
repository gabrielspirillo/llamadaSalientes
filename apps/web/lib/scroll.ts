/**
 * Baja hasta el final el contenedor con scroll que envuelve a `el`, sin tocar
 * la página. `scrollIntoView` desplaza TODOS los ancestros, ventana incluida:
 * en un chat dentro del panel eso movía la página entera con cada mensaje.
 */
export function scrollContainerToBottom(el: HTMLElement | null, smooth = false): void {
  let parent = el?.parentElement ?? null;
  while (parent && parent !== document.body) {
    const { overflowY } = getComputedStyle(parent);
    if (overflowY === 'auto' || overflowY === 'scroll') {
      parent.scrollTo({ top: parent.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
      return;
    }
    parent = parent.parentElement;
  }
}
