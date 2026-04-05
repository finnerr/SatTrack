import { useEffect, useRef, useState, useMemo } from 'react'
import {
  Viewer, Entity, PointGraphics, LabelGraphics,
  PolylineGraphics, EllipseGraphics,
} from 'resium'
import * as Cesium from 'cesium'
import { useSatelliteStore } from '../../store/useSatelliteStore'
import type { SatellitePosition } from '../../types/satellite'
import * as satelliteJs from 'satellite.js'
import { logger } from '../../services/logger'
import { getSimTimeMs } from '../../utils/simTime'

// ── Module-scope Cesium objects (never recreated) ─────────────────────────────

const SKY_ATMOSPHERE = new Cesium.SkyAtmosphere()
const SKY_BOX = new Cesium.SkyBox({
  sources: {
    positiveX: '/cesium/Assets/Textures/SkyBox/tycho2t3_80_px.jpg',
    negativeX: '/cesium/Assets/Textures/SkyBox/tycho2t3_80_mx.jpg',
    positiveY: '/cesium/Assets/Textures/SkyBox/tycho2t3_80_py.jpg',
    negativeY: '/cesium/Assets/Textures/SkyBox/tycho2t3_80_my.jpg',
    positiveZ: '/cesium/Assets/Textures/SkyBox/tycho2t3_80_pz.jpg',
    negativeZ: '/cesium/Assets/Textures/SkyBox/tycho2t3_80_mz.jpg',
  },
})

const GIBS_IMAGERY = new Cesium.UrlTemplateImageryProvider({
  url: 'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/BlueMarble_ShadedRelief_Bathymetry/default/GoogleMapsCompatible_Level8/{z}/{y}/{x}.jpg',
  minimumLevel: 0, maximumLevel: 8,
  tileWidth: 256, tileHeight: 256,
  credit: new Cesium.Credit('NASA GIBS'),
})

const OSM_IMAGERY = new Cesium.UrlTemplateImageryProvider({
  url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
  minimumLevel: 0, maximumLevel: 19,
  credit: new Cesium.Credit('© OpenStreetMap contributors'),
})

// ── Constants ─────────────────────────────────────────────────────────────────

const ORBIT_COLORS: Record<string, Cesium.Color> = {
  LEO:     Cesium.Color.fromCssColorString('#22d3ee'),   // cyan-400
  MEO:     Cesium.Color.fromCssColorString('#fbbf24'),   // amber-400
  GEO:     Cesium.Color.fromCssColorString('#34d399'),   // emerald-400
  HEO:     Cesium.Color.fromCssColorString('#fb923c'),   // orange-400
  UNKNOWN: Cesium.Color.fromCssColorString('#94a3b8'),
}

const ORBIT_POINT_SIZE: Record<string, number> = {
  LEO: 6, MEO: 9, GEO: 13, HEO: 10, UNKNOWN: 6,
}

const LABEL_FONT        = 'bold 13px system-ui, -apple-system, sans-serif'
const LABEL_BG_COLOR    = new Cesium.Color(0.04, 0.06, 0.12, 0.85)
const LABEL_BG_PADDING  = new Cesium.Cartesian2(8, 5)

const TRACK_COLOR          = new Cesium.ColorMaterialProperty(Cesium.Color.WHITE.withAlpha(0.75))
const TRACK_OCCLUDED_COLOR = new Cesium.ColorMaterialProperty(Cesium.Color.WHITE.withAlpha(0.15))
const ARROW_COLOR          = Cesium.Color.fromCssColorString('#f59e0b')
const BORDER_COLOR         = Cesium.Color.fromCssColorString('#ffffff').withAlpha(0.35)
const FOOTPRINT_COLOR      = Cesium.Color.fromCssColorString('#ffffff').withAlpha(0.75)
const STATION_COLOR        = Cesium.Color.fromCssColorString('#22c55e')   // emerald-500
const STATION_SEL_COLOR    = Cesium.Color.fromCssColorString('#86efac')   // emerald-300 (selected)

// ── Orbital track — one full period at actual altitude ────────────────────────

function computeOrbitTrack(line1: string, line2: string, fromMs: number): Cesium.Cartesian3[] {
  const satrec = satelliteJs.twoline2satrec(line1, line2)
  const now    = new Date(fromMs)
  const points: Cesium.Cartesian3[] = []

  // Mean motion (rev/day) → orbital period in minutes
  const meanMotion = parseFloat(line2.substring(52, 63))
  if (!isFinite(meanMotion) || meanMotion <= 0) return []
  const periodMin = 1440 / meanMotion
  const STEPS     = 180  // ~180 points gives smooth track for any orbit class
  const stepMin   = periodMin / STEPS

  for (let i = 0; i <= STEPS; i++) {
    const t  = new Date(now.getTime() + i * stepMin * 60_000)
    const pv = satelliteJs.propagate(satrec, t)
    if (!pv.position || typeof pv.position === 'boolean') continue
    const gmst = satelliteJs.gstime(t)
    const geo  = satelliteJs.eciToGeodetic(pv.position as satelliteJs.EciVec3<number>, gmst)
    points.push(Cesium.Cartesian3.fromDegrees(
      satelliteJs.degreesLong(geo.longitude),
      satelliteJs.degreesLat(geo.latitude),
      geo.height * 1000,
    ))
  }

  return points.length >= 2 ? points : []
}

// ── Direction of travel arrow ─────────────────────────────────────────────────

const ARROW_MINUTES: Record<string, number> = {
  LEO: 3, MEO: 15, GEO: 45, HEO: 10, UNKNOWN: 5,
}

function computeVelocityArrow(line1: string, line2: string, orbitClass: string, fromMs: number): Cesium.Cartesian3[] {
  const satrec    = satelliteJs.twoline2satrec(line1, line2)
  const now       = new Date(fromMs)
  const offsetMin = ARROW_MINUTES[orbitClass] ?? 5
  const points: Cesium.Cartesian3[] = []

  for (const min of [0, offsetMin]) {
    const t  = new Date(now.getTime() + min * 60_000)
    const pv = satelliteJs.propagate(satrec, t)
    if (!pv.position || typeof pv.position === 'boolean') return []
    const gmst = satelliteJs.gstime(t)
    const geo  = satelliteJs.eciToGeodetic(pv.position as satelliteJs.EciVec3<number>, gmst)
    points.push(Cesium.Cartesian3.fromDegrees(
      satelliteJs.degreesLong(geo.longitude),
      satelliteJs.degreesLat(geo.latitude),
      geo.height * 1000,
    ))
  }
  return points.length === 2 ? points : []
}


// ── Component ─────────────────────────────────────────────────────────────────

type ImageryMode = 'satellite' | 'streets'

export default function Globe() {
  const viewerRef        = useRef<{ cesiumElement: Cesium.Viewer } | null>(null)
  const bordersRef       = useRef<Cesium.GeoJsonDataSource | null>(null)
  const cursorDisplayRef = useRef<HTMLSpanElement>(null)
  const [imageryMode,   setImageryMode]   = useState<ImageryMode>(
    () => (localStorage.getItem('sattrack_imagery') as ImageryMode) ?? 'satellite'
  )
  const [showFootprint, setShowFootprint] = useState(true)
  // Ref so the delayed imagery retry can read the current mode without stale closure
  const imageryModeRef = useRef<ImageryMode>(
    (localStorage.getItem('sattrack_imagery') as ImageryMode) ?? 'satellite'
  )

  const { positions, selected, setSelected, allSatellites } = useSatelliteStore()
  const groundStations      = useSatelliteStore((s) => s.groundStations)
  const selectedStationIds  = useSatelliteStore((s) => s.selectedStationIds)
  const simClock            = useSatelliteStore((s) => s.simClock)
  const pickingLocation     = useSatelliteStore((s) => s.pickingLocation)
  const pickedLocation      = useSatelliteStore((s) => s.pickedLocation)
  const setPickingLocation  = useSatelliteStore((s) => s.setPickingLocation)
  const setPickedLocation   = useSatelliteStore((s) => s.setPickedLocation)


  // ── Init ────────────────────────────────────────────────────────────────────

  useEffect(() => {
    Cesium.Ion.defaultAccessToken = ''
  }, [])

  useEffect(() => {
    const viewer = viewerRef.current?.cesiumElement
    if (!viewer) return
    viewer.clock.currentTime = Cesium.JulianDate.fromDate(new Date())
    viewer.clock.shouldAnimate = false
    viewer.scene.camera.setView({
      destination: Cesium.Cartesian3.fromDegrees(0, 20, 28_000_000),
    })

    // Cesium 1.104+ resolves its internal createWorldImagery() promise at an
    // unpredictable time and adds its own layer on top of ours.  No fixed
    // timeout is reliable.  Instead, run a postRender guard for 5 s that
    // removes any extra layer the frame it appears.  After 5 s Cesium is
    // always settled and normal user-driven imagery switching takes over.
    // Apply correct imagery on the very first postRender frame, then guard for
    // 5 s against Cesium's async createWorldImagery() promise re-inserting its
    // default layer.  The length===1 short-circuit is skipped on the first call
    // because the single existing layer may still be the blue-marble default.
    let firstApply = true
    const guardUntil = Date.now() + 5000
    const removeGuard = viewer.scene.postRender.addEventListener(() => {
      if (Date.now() > guardUntil) { removeGuard(); return }
      if (!firstApply && viewer.imageryLayers.length === 1) return  // already clean
      firstApply = false
      viewer.imageryLayers.removeAll()
      viewer.imageryLayers.addImageryProvider(
        imageryModeRef.current === 'satellite' ? GIBS_IMAGERY : OSM_IMAGERY
      )
    })

    return () => removeGuard()
  }, [])  // eslint-disable-line react-hooks/exhaustive-deps

  // ── Imagery switching ────────────────────────────────────────────────────────

  useEffect(() => {
    imageryModeRef.current = imageryMode
    localStorage.setItem('sattrack_imagery', imageryMode)
    const viewer = viewerRef.current?.cesiumElement
    if (!viewer) return
    viewer.imageryLayers.removeAll()
    viewer.imageryLayers.addImageryProvider(imageryMode === 'satellite' ? GIBS_IMAGERY : OSM_IMAGERY)
  }, [imageryMode])

  // ── Country borders ──────────────────────────────────────────────────────────

  useEffect(() => {
    const viewer = viewerRef.current?.cesiumElement
    if (!viewer) return

    Cesium.GeoJsonDataSource.load('/ne_countries.geojson', {
      stroke: BORDER_COLOR,
      fill: Cesium.Color.TRANSPARENT,
      strokeWidth: 1.5,
    }).then((source) => {
      viewer.dataSources.add(source)
      bordersRef.current = source
      logger.info('Globe', 'Country borders loaded')
    }).catch(() => {
      logger.debug('Globe', 'ne_countries.geojson not found — run npm run fetch-tles')
    })

    return () => {
      if (bordersRef.current && !viewer.isDestroyed())
        viewer.dataSources.remove(bordersRef.current)
    }
  }, [])  // eslint-disable-line react-hooks/exhaustive-deps

  // ── Click handler via ScreenSpaceEventHandler ────────────────────────────────
  // Uses postRender one-shot to guarantee Cesium is fully settled before we
  // attach the handler — avoids the timing race on first mount.

  useEffect(() => {
    const viewer = viewerRef.current?.cesiumElement
    if (!viewer) return

    let handler: Cesium.ScreenSpaceEventHandler | null = null

    const setupHandler = () => {
      handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas)

      // LEFT_CLICK: ground station entity → satellite fallback → deselect
      // Note: pick-on-map is handled by React onClick on the outer div (more reliable)
      handler.setInputAction((event: { position: Cesium.Cartesian2 }) => {
        if (useSatelliteStore.getState().pickingLocation) return  // React onClick handles it

        // 1. Entity pick — detect ground stations by their 'gs-<id>' entity id
        const picked = viewer.scene.pick(event.position)
        if (Cesium.defined(picked) && picked.id instanceof Cesium.Entity) {
          const entityId = picked.id.id as string | undefined
          if (typeof entityId === 'string' && entityId.startsWith('gs-')) {
            const gsId = entityId.slice(3)
            useSatelliteStore.getState().setSelectedStation(gsId)
            return
          }
          // Satellite entity — Resium's onClick handles selection + sets entityClickedRef
          return
        }

        // 2. Empty space click — deselect everything
        setSelected(null)
        useSatelliteStore.getState().setSelectedStation(null)
      }, Cesium.ScreenSpaceEventType.LEFT_CLICK)
    }

    // Attach after first render — mirrors the OSM imagery init pattern
    const removePostRender = viewer.scene.postRender.addEventListener(() => {
      removePostRender()
      setupHandler()
    })

    return () => {
      removePostRender()
      handler?.destroy()
    }
  }, [setSelected])  // eslint-disable-line react-hooks/exhaustive-deps

  // ── Cursor lat/lon + pick-on-map — plain React events, no Cesium system needed

  const pickEllipsoidAt = (e: React.MouseEvent<HTMLDivElement>) => {
    const viewer = viewerRef.current?.cesiumElement
    if (!viewer) return null
    const rect = e.currentTarget.getBoundingClientRect()
    return viewer.camera.pickEllipsoid(
      new Cesium.Cartesian2(e.clientX - rect.left, e.clientY - rect.top),
      Cesium.Ellipsoid.WGS84,
    ) ?? null
  }

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const cartesian = pickEllipsoidAt(e)
    if (cartesian) {
      const carto  = Cesium.Cartographic.fromCartesian(cartesian)
      const lat    = Cesium.Math.toDegrees(carto.latitude)
      const lon    = Cesium.Math.toDegrees(carto.longitude)
      const latStr = lat >= 0 ? `${lat.toFixed(4)}°N` : `${Math.abs(lat).toFixed(4)}°S`
      const lonStr = lon >= 0 ? `${lon.toFixed(4)}°E` : `${Math.abs(lon).toFixed(4)}°W`
      if (cursorDisplayRef.current) {
        cursorDisplayRef.current.textContent = `${latStr}  ${lonStr}`
        cursorDisplayRef.current.style.opacity = '1'
      }
      useSatelliteStore.getState().setCursorLatLon({ lat, lon })
    } else {
      if (cursorDisplayRef.current) cursorDisplayRef.current.style.opacity = '0'
      useSatelliteStore.getState().setCursorLatLon(null)
    }
  }

  const handleMouseLeave = () => {
    if (cursorDisplayRef.current) cursorDisplayRef.current.style.opacity = '0'
    useSatelliteStore.getState().setCursorLatLon(null)
  }

  const handleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!pickingLocation) return
    const cartesian = pickEllipsoidAt(e)
    if (cartesian) {
      const carto = Cesium.Cartographic.fromCartesian(cartesian)
      setPickedLocation({
        lat: Cesium.Math.toDegrees(carto.latitude),
        lon: Cesium.Math.toDegrees(carto.longitude),
      })
      setPickingLocation(false)
    }
  }

  // ── Escape key cancels pick mode ─────────────────────────────────────────────

  useEffect(() => {
    if (!pickingLocation) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setPickingLocation(false)
        setPickedLocation(null)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [pickingLocation, setPickingLocation, setPickedLocation])

  // ── Handlers ─────────────────────────────────────────────────────────────────

  const handleSatClick = (pos: SatellitePosition) => {
    const meta = allSatellites.find((s) => s.noradId === pos.noradId)
    setSelected({ ...pos, line1: meta?.line1 ?? '', line2: meta?.line2 ?? '' })
  }

  // handleStationClick is handled directly in the ScreenSpaceEventHandler via scene.pick()

  // ── Live position — tracks propagation ticks for the selected satellite ───────

  const livePos = useMemo(() => {
    if (!selected) return null
    return positions.find((p) => p.noradId === selected.noradId) ?? selected
  }, [selected, positions])

  // ── Camera fly — fires once per selection, never on position ticks ────────────

  useEffect(() => {
    if (!selected) return
    const viewer = viewerRef.current?.cesiumElement
    if (!viewer || viewer.isDestroyed()) return
    viewer.camera.flyTo({
      destination: Cesium.Cartesian3.fromDegrees(
        selected.lon, selected.lat,
        Math.max(selected.alt * 1000 + 2_000_000, 4_000_000),
      ),
      duration: 1.5,
    })
  }, [selected?.noradId])  // eslint-disable-line react-hooks/exhaustive-deps

  // ── Orbital track ─────────────────────────────────────────────────────────────

  const orbitTrackPoints = useMemo(() => {
    if (!selected || !selected.line1 || selected.orbitClass === 'GEO') return []
    return computeOrbitTrack(selected.line1, selected.line2, getSimTimeMs(simClock))
  }, [selected?.noradId, simClock.offsetMs])  // eslint-disable-line react-hooks/exhaustive-deps

  const velocityArrow = useMemo(() => {
    if (!selected?.line1 || selected.orbitClass === 'GEO') return []
    return computeVelocityArrow(selected.line1, selected.line2, selected.orbitClass, getSimTimeMs(simClock))
  }, [selected?.noradId, simClock.offsetMs])  // eslint-disable-line react-hooks/exhaustive-deps

  const arrowMaterial = useMemo(() => {
    if (!selected) return null
    return new Cesium.PolylineArrowMaterialProperty(ARROW_COLOR)
  }, [selected?.noradId])  // eslint-disable-line react-hooks/exhaustive-deps

  const footprintFillMaterial = useMemo(() => {
    if (!livePos) return null
    const base = ORBIT_COLORS[livePos.orbitClass] ?? ORBIT_COLORS.UNKNOWN
    return new Cesium.ColorMaterialProperty(base.withAlpha(0.10))
  }, [livePos?.orbitClass])  // eslint-disable-line react-hooks/exhaustive-deps

  const footprintRadius = useMemo(() => {
    if (!livePos) return 0
    const R = 6_371_000  // Earth radius in metres
    const h = livePos.alt * 1000
    return R * Math.acos(R / (R + h))
  }, [livePos])  // updates with every position tick

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <div
      className={`relative w-full h-full${pickingLocation ? ' cursor-crosshair' : ''}`}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      onClick={handleClick}
    >
      <Viewer
        ref={viewerRef}
        full
        imageryProvider={false as unknown as Cesium.ImageryProvider}
        baseLayerPicker={false}
        geocoder={false}
        homeButton={false}
        sceneModePicker={false}
        navigationHelpButton={false}
        animation={false}
        timeline={false}
        fullscreenButton={false}
        infoBox={false}
        selectionIndicator={false}
        skyAtmosphere={SKY_ATMOSPHERE}
        skyBox={SKY_BOX}
      >
        {/* Satellite points */}
        {positions.map((pos) => {
          const position   = Cesium.Cartesian3.fromDegrees(pos.lon, pos.lat, pos.alt * 1000)
          const baseColor  = pos.groupColor
            ? Cesium.Color.fromCssColorString(pos.groupColor)
            : (ORBIT_COLORS[pos.orbitClass] ?? ORBIT_COLORS.UNKNOWN)
          const baseSize   = ORBIT_POINT_SIZE[pos.orbitClass] ?? 6
          const isSelected = selected?.noradId === pos.noradId

          return (
            <Entity
              key={pos.noradId}
              position={position}
              onClick={() => handleSatClick(pos)}
            >
              <PointGraphics
                pixelSize={isSelected ? baseSize + 6 : baseSize}
                color={isSelected ? Cesium.Color.WHITE : baseColor}
                outlineColor={isSelected ? baseColor : Cesium.Color.WHITE.withAlpha(0.7)}
                outlineWidth={isSelected ? 3 : 1.5}
              />
              {isSelected && (
                <LabelGraphics
                  text={pos.name}
                  font={LABEL_FONT}
                  fillColor={Cesium.Color.WHITE}
                  outlineColor={Cesium.Color.BLACK}
                  outlineWidth={2.5}
                  style={Cesium.LabelStyle.FILL_AND_OUTLINE}
                  verticalOrigin={Cesium.VerticalOrigin.BOTTOM}
                  pixelOffset={new Cesium.Cartesian2(0, -16)}
                  showBackground={true}
                  backgroundColor={LABEL_BG_COLOR}
                  backgroundPadding={LABEL_BG_PADDING}
                  disableDepthTestDistance={Number.POSITIVE_INFINITY}
                />
              )}
            </Entity>
          )
        })}

        {/* Orbital track — rendered at actual altitude in 3D space */}
        {orbitTrackPoints.length > 0 && (
          <Entity key={`track-${selected?.noradId}`}>
            <PolylineGraphics
              positions={orbitTrackPoints}
              width={2}
              material={TRACK_COLOR}
              depthFailMaterial={TRACK_OCCLUDED_COLOR}
              arcType={Cesium.ArcType.NONE}
            />
          </Entity>
        )}

        {/* Velocity arrow — direction of travel */}
        {velocityArrow.length === 2 && arrowMaterial && (
          <Entity key={`arrow-${selected?.noradId}`}>
            <PolylineGraphics
              positions={velocityArrow}
              width={14}
              material={arrowMaterial}
              arcType={Cesium.ArcType.NONE}
            />
          </Entity>
        )}

        {/* Nadir marker — ground point directly below selected satellite */}
        {livePos && (
          <>
            {/* Vertical nadir line: satellite → ground */}
            <Entity key={`nadir-line-${livePos.noradId}`}>
              <PolylineGraphics
                positions={[
                  Cesium.Cartesian3.fromDegrees(livePos.lon, livePos.lat, livePos.alt * 1000),
                  Cesium.Cartesian3.fromDegrees(livePos.lon, livePos.lat, 0),
                ]}
                width={1}
                material={new Cesium.ColorMaterialProperty(Cesium.Color.WHITE.withAlpha(0.35))}
                arcType={Cesium.ArcType.NONE}
              />
            </Entity>

            {/* Nadir surface cross */}
            <Entity
              key={`nadir-${livePos.noradId}`}
              position={Cesium.Cartesian3.fromDegrees(livePos.lon, livePos.lat, 0)}
            >
              <PointGraphics
                pixelSize={6}
                color={Cesium.Color.WHITE}
                outlineColor={Cesium.Color.BLACK.withAlpha(0.7)}
                outlineWidth={1.5}
                disableDepthTestDistance={Number.POSITIVE_INFINITY}
              />
            </Entity>
          </>
        )}

        {/* Footprint — nadir coverage cone projected to Earth surface */}
        {livePos && showFootprint && footprintRadius > 0 && (
          <Entity
            key={`footprint-${livePos.noradId}`}
            position={Cesium.Cartesian3.fromDegrees(livePos.lon, livePos.lat, 0)}
          >
            <EllipseGraphics
              semiMajorAxis={footprintRadius}
              semiMinorAxis={footprintRadius}
              fill={true}
              material={footprintFillMaterial ?? undefined}
              outline={true}
              outlineColor={FOOTPRINT_COLOR}
              outlineWidth={2}
              height={0}
              granularity={Cesium.Math.toRadians(1)}
            />
          </Entity>
        )}

        {/* Preview pin — shown after picking a location, before the form is saved */}
        {pickedLocation && (
          <Entity
            key="gs-preview"
            position={Cesium.Cartesian3.fromDegrees(pickedLocation.lon, pickedLocation.lat, 0)}
          >
            <PointGraphics
              pixelSize={10}
              color={Cesium.Color.fromCssColorString('#fbbf24')}
              outlineColor={Cesium.Color.BLACK.withAlpha(0.7)}
              outlineWidth={2}
            />
            <LabelGraphics
              text="New station"
              font="10px monospace"
              fillColor={Cesium.Color.fromCssColorString('#fbbf24')}
              outlineColor={Cesium.Color.BLACK}
              outlineWidth={2}
              style={Cesium.LabelStyle.FILL_AND_OUTLINE}
              verticalOrigin={Cesium.VerticalOrigin.BOTTOM}
              pixelOffset={new Cesium.Cartesian2(0, -14)}
            />
          </Entity>
        )}

        {/* Ground station markers — no disableDepthTestDistance so Earth occludes them */}
        {groundStations.filter((gs) => gs.visible).map((gs) => {
          const isSelected = selectedStationIds.includes(gs.id)
          const color      = isSelected ? STATION_SEL_COLOR : STATION_COLOR
          return (
            <Entity
              key={gs.id}
              id={`gs-${gs.id}`}
              position={Cesium.Cartesian3.fromDegrees(gs.lon, gs.lat, gs.elevationM)}
            >
              <PointGraphics
                pixelSize={isSelected ? 13 : 10}
                color={color}
                outlineColor={Cesium.Color.WHITE.withAlpha(0.7)}
                outlineWidth={isSelected ? 2.5 : 1.5}
              />
              <LabelGraphics
                text={gs.name}
                font="bold 12px system-ui, -apple-system, sans-serif"
                fillColor={Cesium.Color.WHITE}
                outlineColor={Cesium.Color.BLACK}
                outlineWidth={2.5}
                style={Cesium.LabelStyle.FILL_AND_OUTLINE}
                verticalOrigin={Cesium.VerticalOrigin.BOTTOM}
                pixelOffset={new Cesium.Cartesian2(0, -16)}
                showBackground={isSelected}
                backgroundColor={LABEL_BG_COLOR}
                backgroundPadding={LABEL_BG_PADDING}
              />
            </Entity>
          )
        })}


      </Viewer>

      {/* ── Globe toolbar — top-right, below SearchBar ── */}
      <div className="absolute top-16 right-4 z-10 flex gap-1 items-center">
        {(['satellite', 'streets'] as ImageryMode[]).map((mode) => (
          <button
            key={mode}
            onClick={() => setImageryMode(mode)}
            className={`
              text-xs px-2 py-1 rounded border transition-colors font-mono
              ${imageryMode === mode
                ? 'bg-cyan-500/20 border-cyan-500/50 text-cyan-400'
                : 'bg-space-900/80 border-space-700 text-slate-500 hover:text-slate-300'}
            `}
          >
            {mode === 'satellite' ? 'SAT' : 'OSM'}
          </button>
        ))}
        {selected && (
          <button
            onClick={() => setShowFootprint((v) => !v)}
            className={`
              text-xs px-2 py-1 rounded border transition-colors font-mono
              ${showFootprint
                ? 'bg-cyan-500/20 border-cyan-500/50 text-cyan-400'
                : 'bg-space-900/80 border-space-700 text-slate-500 hover:text-slate-300'}
            `}
          >
            FTPRNT
          </button>
        )}
      </div>

      {/* ── Cursor lat/lon overlay — updated via DOM ref, no React re-render ── */}
      <span
        ref={cursorDisplayRef}
        className="absolute bottom-9 left-1/2 -translate-x-1/2 z-10 pointer-events-none font-mono text-[11px] text-slate-200 bg-space-900/80 backdrop-blur-sm border border-space-700/50 rounded px-2 py-0.5 whitespace-nowrap"
        style={{ opacity: 0 }}
      />

      {/* ── Pick mode banner ── */}
      {pickingLocation && (
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-20 pointer-events-none flex flex-col items-center gap-2">
          <div className="bg-space-900/90 border border-emerald-500/50 rounded-lg px-6 py-3 text-center shadow-2xl">
            <p className="text-emerald-400 text-sm font-semibold">Click on the globe to place station</p>
          </div>
          <button
            className="pointer-events-auto text-xs text-slate-400 hover:text-white border border-space-700 bg-space-900/80 rounded px-3 py-1 transition-colors"
            onClick={() => { setPickingLocation(false); setPickedLocation(null) }}
          >
            Cancel
          </button>
        </div>
      )}
    </div>
  )
}
