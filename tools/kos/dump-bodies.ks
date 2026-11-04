// Dumps every celestial body's parameters to JSON, to cross-check a pack against the game.
// Usage (kOS, in flight): copy to Ships/Script, then `runpath("0:/dump-bodies.ks").`
// Writes Ships/Script/bodies-dump.json. Angles are degrees, as kOS reports them.
// Then: KOS_DUMP=path/to/bodies-dump.json PACK=stock npm test -- kos
local out is lexicon().
out:add("ut", time:seconds).
list bodies in all.
for b in all {
  local e is lexicon().
  e:add("radius", b:radius).
  e:add("mu", b:mu).
  e:add("rotationPeriod", b:rotationperiod).
  if b:atm:exists { e:add("atmosphereHeight", b:atm:height). }
  if b:hasbody {
    local o is b:orbit.
    e:add("parent", b:body:name).
    e:add("soi", b:soiradius).
    e:add("semiMajorAxis", o:semimajoraxis).
    e:add("eccentricity", o:eccentricity).
    e:add("inclination", o:inclination).
    e:add("longitudeOfAscendingNode", o:lan).
    e:add("argumentOfPeriapsis", o:argumentofperiapsis).
    e:add("meanAnomalyAtEpoch", o:meananomalyatepoch).
    e:add("epoch", o:epoch).
    e:add("period", o:period).
  }
  out:add(b:name, e).
}
writejson(out, "0:/bodies-dump.json").
print "Wrote 0:/bodies-dump.json with " + all:length + " bodies.".
