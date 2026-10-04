// Keep prompts compact, while retaining the geometry needed to explain a route.
export function describe(game, state) {
  if(game==='football-legends') return {clock:state.clock,state:state.state,core:state.core,match:state.match,ball:state.ball,players:state.players};
  return {clock:state.clock,state:state.state,completed:state.completed,unlockedLevels:state.unlockedLevels,layout:state.layout,players:state.players,objects:state.objects.filter(object=>['t44','t45','t49','t51','t67'].includes(object.type))};
}
