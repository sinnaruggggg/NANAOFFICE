import { getSlideTitle } from '@office-kit/pptx';

export function createSlideShow(parent, {el,button,bitmap}) {
  const dialog = el('dialog',undefined,'slide-show');
  dialog.setAttribute('aria-label','슬라이드 쇼');
  const screen = el('div',undefined,'slide-show-screen');
  screen.tabIndex = 0;
  screen.autofocus = true;
  const image = el('img',undefined,'slide-show-image');
  image.draggable = false;
  const error = el('p','이 슬라이드를 표시할 수 없습니다.','slide-show-error');
  error.hidden = true;
  const controls = el('div',undefined,'slide-show-controls');
  const count = el('span',undefined,'slide-show-count');
  count.setAttribute('aria-live','polite');
  const previous = button('이전',() => draw(index-1));
  const next = button('다음',() => draw(index+1));
  const exit = button('쇼 종료',() => dialog.close());
  controls.append(previous,count,next,exit);
  screen.append(image,error);
  dialog.append(screen,controls);
  parent.append(dialog);
  let pages = [];
  let index = 0;
  let url;
  let gesture;
  let ownsFullscreen = false;
  const android = window.NanaAndroid;

  function draw(position) {
    if (position < 0 || position >= pages.length) return;
    index = position;
    if (url) URL.revokeObjectURL(url);
    url = undefined;
    error.hidden = true;
    image.hidden = false;
    image.alt = getSlideTitle(pages[index]) || (index+1)+'번 슬라이드';
    try {
      url = bitmap(pages[index]);
      image.src = url;
    } catch {
      image.removeAttribute('src');
      image.hidden = true;
      error.hidden = false;
    }
    count.textContent = (index+1)+' / '+pages.length;
    const focused = document.activeElement;
    previous.disabled = index === 0;
    next.disabled = index === pages.length-1;
    if ((focused === previous && previous.disabled) || (focused === next && next.disabled)) {
      screen.focus({preventScroll:true});
    }
  }
  screen.addEventListener('pointerdown',event => {
    if (!event.isPrimary || event.button !== 0) return;
    gesture = {id:event.pointerId,x:event.clientX,y:event.clientY};
    screen.setPointerCapture(event.pointerId);
  });
  screen.addEventListener('pointercancel',() => { gesture = undefined; });
  screen.addEventListener('pointerup',event => {
    if (gesture?.id !== event.pointerId) return;
    const dx = event.clientX-gesture.x;
    const dy = event.clientY-gesture.y;
    gesture = undefined;
    if (Math.abs(dx) > 35 && Math.abs(dx) > Math.abs(dy)) draw(index+(dx < 0 ? 1 : -1));
    else if (Math.hypot(dx,dy) < 8) draw(index+1);
  });
  dialog.addEventListener('keydown',event => {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    const key = event.key;
    if (key === 'Escape') dialog.close();
    else if (['ArrowLeft','ArrowUp','PageUp'].includes(key)) draw(index-1);
    else if (['ArrowRight','ArrowDown','PageDown'].includes(key) ||
      ([' ','Enter'].includes(key) && !event.target.closest('button'))) draw(index+1);
    else if (key === 'Home') draw(0);
    else if (key === 'End') draw(pages.length-1);
    else return;
    event.preventDefault();
  });
  function stop() {
    if (dialog.open || !pages.length) return;
    android?.setPresentationMode?.(false);
    if (ownsFullscreen && document.fullscreenElement === document.documentElement) {
      void document.exitFullscreen().catch(() => {});
    }
    ownsFullscreen = false;
    if (url) URL.revokeObjectURL(url);
    url = undefined;
    image.removeAttribute('src');
    gesture = undefined;
    pages = [];
  }
  function fullscreenChanged() {
    if (dialog.open && ownsFullscreen && !document.fullscreenElement) dialog.close();
  }
  dialog.addEventListener('close',stop);
  document.addEventListener('fullscreenchange',fullscreenChanged);
  return {
    get active() { return dialog.open; },
    open(slides,start) {
      if (dialog.open) return;
      pages = slides;
      dialog.showModal();
      draw(start);
      if (android?.setPresentationMode) android.setPresentationMode(true);
      else if (document.fullscreenEnabled && !document.fullscreenElement) {
        ownsFullscreen = true;
        void document.documentElement.requestFullscreen().catch(() => { ownsFullscreen = false; });
      }
    },
    dispose() {
      if (dialog.open) dialog.close();
      stop();
      document.removeEventListener('fullscreenchange',fullscreenChanged);
      dialog.removeEventListener('close',stop);
      dialog.remove();
    },
  };
}
