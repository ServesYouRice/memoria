/**
 * The world-space point at the centre of the viewport. The Stage renders a
 * world point at `world * zoom + position`, so the inverse divides the
 * screen-centre offset by zoom.
 */
export function viewportCenterWorld(
  position: { x: number; y: number },
  stageSize: { width: number; height: number },
  zoom: number,
): { x: number; y: number } {
  return {
    x: (-position.x + stageSize.width / 2) / zoom,
    y: (-position.y + stageSize.height / 2) / zoom,
  };
}
