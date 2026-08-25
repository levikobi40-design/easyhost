import {
  ECHO_PROPERTIES,
  buildRoomsForProperty,
  computeEchoStats,
} from '../src/data/echoHotels.ts';

for (const p of ECHO_PROPERTIES) {
  const rooms = buildRoomsForProperty(p.id);
  const allowed = new Set(p.roomTypes.map((t) => t.type));
  const bad = rooms.filter((r) => !allowed.has(r.roomType) || r.propertyId !== p.id);
  if (rooms.length !== p.totalUnits || bad.length) {
    console.error('FAIL', p.name, { len: rooms.length, expected: p.totalUnits, bad });
    process.exit(1);
  }
  const stats = computeEchoStats(rooms);
  console.log('OK', p.name, stats.totalRooms, 'occ%', stats.occupancyPct);
}
console.log('All Echo property grids validated.');
