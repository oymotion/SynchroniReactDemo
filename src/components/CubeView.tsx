import { useElementWidth } from './common';

const VERTICES: ReadonlyArray<readonly [number, number, number]> = [
  [-1, -1, -1], [1, -1, -1], [1, 1, -1], [-1, 1, -1],
  [-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1],
];
const FACES: ReadonlyArray<readonly [number, number, number, number]> = [
  [0, 1, 2, 3], [4, 5, 6, 7], [0, 1, 5, 4],
  [2, 3, 7, 6], [0, 3, 7, 4], [1, 2, 6, 5],
];
const FACE_COLORS = ['#00b4b4', '#c83cc8', '#dcc828', '#c83c3c', '#3ca03c', '#3c64dc'];
const AXES: ReadonlyArray<readonly [number, number, number]> = [[1.5, 0, 0], [0, 1.5, 0], [0, 0, 1.5]];
const AXIS_COLORS = ['#dc3c3c', '#3cc83c', '#5078ff'];

export default function CubeView({
  quaternion,
  placeholder = 'Not connected',
  height = 220,
}: {
  quaternion: [number, number, number, number] | null;
  placeholder?: string;
  height?: number;
}) {
  const [ref, width] = useElementWidth<HTMLDivElement>();
  let body: React.ReactNode = <span className="plot-placeholder">{placeholder}</span>;
  if (quaternion && width > 1) {
    let [w, x, y, z] = quaternion;
    const norm = Math.hypot(w, x, y, z);
    if (norm > 0) {
      w /= norm;
      x /= norm;
      y /= norm;
      z /= norm;
      const matrix = [
        [1 - 2 * (y * y + z * z), 2 * (x * y - w * z), 2 * (x * z + w * y)],
        [2 * (x * y + w * z), 1 - 2 * (x * x + z * z), 2 * (y * z - w * x)],
        [2 * (x * z - w * y), 2 * (y * z + w * x), 1 - 2 * (x * x + y * y)],
      ];
      const scale = Math.min(width, height) * 0.28;
      const rotate = (v: readonly [number, number, number]) => matrix.map(
        (row) => row[0]! * v[0] + row[1]! * v[1] + row[2]! * v[2],
      );
      const project = (v: number[]): [number, number] => {
        const perspective = 4.5 / (4.5 + v[2]!);
        return [width / 2 + v[0]! * scale * perspective, height / 2 - v[1]! * scale * perspective];
      };
      const rotated = VERTICES.map(rotate);
      const order = FACES.map((_, index) => index).sort((a, b) => {
        const za = FACES[a]!.reduce((sum, index) => sum + rotated[index]![2]!, 0);
        const zb = FACES[b]!.reduce((sum, index) => sum + rotated[index]![2]!, 0);
        return zb - za;
      });
      const origin = project(rotate([0, 0, 0]));
      body = (
        <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
          {order.map((face) => (
            <polygon
              key={face}
              points={FACES[face]!.map((index) => project(rotated[index]!).map((value) => value.toFixed(1)).join(',')).join(' ')}
              fill={FACE_COLORS[face]}
              stroke="#141414"
            />
          ))}
          {AXES.map((axis, index) => {
            const tip = project(rotate(axis));
            return <line key={index} x1={origin[0]} y1={origin[1]} x2={tip[0]} y2={tip[1]} stroke={AXIS_COLORS[index]} strokeWidth={2} />;
          })}
        </svg>
      );
    }
  }
  return <section className="cube-card" style={{ height }} ref={ref} aria-label="Quaternion 3D cube">{body}</section>;
}
