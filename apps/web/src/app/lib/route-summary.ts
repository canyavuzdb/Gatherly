export type RouteSummary = { mode: 'WALKING' | 'CYCLING' | 'DRIVING' };

export function routeSummaryLabel(route: RouteSummary | undefined) {
  if (!route) return null;
  return route.mode === 'WALKING' ? 'Yürüyüş rotası' : route.mode === 'CYCLING' ? 'Bisiklet rotası' : 'Araç rotası';
}
