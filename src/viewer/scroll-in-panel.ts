const liftClearOfTray = (element: HTMLElement) => {
  const tray = document.querySelector('.review-tray');
  if (!tray) return;
  const covered = element.getBoundingClientRect().bottom - tray.getBoundingClientRect().top;
  if (covered > 0) window.scrollBy(0, covered);
};

export const scrollInPanel = (element: HTMLElement, block: ScrollLogicalPosition) => {
  const { scrollX, scrollY } = window;
  element.scrollIntoView({ block });
  window.scrollTo(scrollX, scrollY);
  if (block === 'center') liftClearOfTray(element);
};
