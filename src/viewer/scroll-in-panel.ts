export const scrollInPanel = (element: HTMLElement, block: ScrollLogicalPosition) => {
  const { scrollX, scrollY } = window;
  element.scrollIntoView({ block });
  window.scrollTo(scrollX, scrollY);
};
