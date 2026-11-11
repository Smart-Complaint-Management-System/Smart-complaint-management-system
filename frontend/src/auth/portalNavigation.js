export function getVisibleNavigationItems(items, activeRole) {
  return items.filter((item) => !item.role || item.role === activeRole);
}
