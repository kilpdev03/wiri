import { useEffect, useState } from "react";
import { ipc, type AudioDevice, type AudioDevices } from "../../lib/ipc";
import { sounds } from "../../lib/sounds";
import { useIsland } from "../../store/islandStore";
import { HeadphonesIcon, MicIcon } from "../icons";

function DeviceSelect({
  label,
  icon,
  devices,
  busy,
  onPick,
}: {
  label: string;
  icon: React.ReactNode;
  devices: AudioDevice[];
  busy: boolean;
  onPick: (id: string) => void;
}) {
  const current = devices.find((d) => d.isDefault);
  return (
    <label className={`device-select ${busy ? "busy" : ""}`}>
      <span className="section-title row gap-6">{icon} {label}</span>
      <span className="select-wrap">
        <select value={current?.id ?? ""} disabled={devices.length === 0} onChange={(e) => onPick(e.target.value)}>
          {devices.length === 0 && <option value="">Sin dispositivos</option>}
          {devices.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </select>
      </span>
    </label>
  );
}

/**
 * Salida y entrada de audio predeterminadas de Windows, como dos selectores.
 * Se refresca al montar y cada vez que Windows cambia de salida.
 */
export function AudioDevicesCard() {
  const [devices, setDevices] = useState<AudioDevices | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // El OSD "Ahora suena en…" llega cuando cambia la salida (desde aquí o desde Windows).
  const deviceOsd = useIsland((s) => (s.osd?.kind === "device" ? s.osd.until : 0));

  const load = () => ipc.audioDevices().then(setDevices).catch((e) => setError(String(e)));
  useEffect(() => {
    load();
  }, [deviceOsd]);

  const pick = async (id: string) => {
    setBusy(true);
    setError(null);
    try {
      await ipc.audioSetDefault(id);
      sounds.done();
      await load();
    } catch (e) {
      setError(String(e));
      sounds.nope();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="col gap-10">
      <DeviceSelect label="Salida" icon={<HeadphonesIcon size={12} />} devices={devices?.outputs ?? []} busy={busy} onPick={pick} />
      <DeviceSelect label="Entrada" icon={<MicIcon size={12} />} devices={devices?.inputs ?? []} busy={busy} onPick={pick} />
      {error && <span className="field-error">{error}</span>}
    </div>
  );
}
