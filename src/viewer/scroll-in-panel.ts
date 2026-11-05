const coveredByTray = (bottom: number) => {
  const tray = document.querySelector('.review-tray');
  return tray ? bottom - tray.getBoundingClientRect().top : 0;
};

const keepInWindow = (element: HTMLElement) => {
  const { top, bottom } = element.getBoundingClientRect();
  const covered = coveredByTray(bottom);
  if (top < 0) window.scrollBy(0, top);
  else if (covered > 0) window.scrollBy(0, covered);
};

export const scrollInPanel = (element: HTMLElement, block: ScrollLogicalPosition) => {
  const { scrollX, scrollY } = window;
  element.scrollIntoView({ block });
  window.scrollTo(scrollX, scrollY);
  if (block === 'center') keepInWindow(element);
};
