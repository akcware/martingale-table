export interface ChartMarker {
  round: number;
  /** dollars */
  value: number;
}

export interface ChartEndMarker extends ChartMarker {
  reason: 'bust' | 'cap';
}
