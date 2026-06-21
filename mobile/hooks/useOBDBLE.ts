// hooks/useOBDBLE.ts — MecaIA Mobile — OBD2 Bluetooth Low Energy
// Phase 1 : scan + connexion BLE classique (RFCOMM via react-native-bluetooth-classic)
// Phase 2 : BLE natif pour iOS CoreBluetooth

import { useState, useEffect, useCallback, useRef } from 'react';

// Service UUID standard OBD2 BLE (ELM327 compatible)
const OBD_SERVICE_UUID = '00001101-0000-1000-8000-00805f9b34fb'; // SPP UUID RFCOMM
const OBD_CHAR_RX      = '00001101-0000-1000-8000-00805f9b34fb';

export type OBDState = 'idle' | 'scanning' | 'connecting' | 'connected' | 'error';
export type LiveData = Record<string, { value: string; unit: string; label: string }>;

const PID_MAP: Record<string, { label: string; unit: string; mode: string }> = {
  '010C': { label: 'RPM',         unit: 'tr/min', mode: '01' },
  '010D': { label: 'Vitesse',     unit: 'km/h',   mode: '01' },
  '0105': { label: 'Refroid.',    unit: '°C',      mode: '01' },
  '010B': { label: 'Boost',       unit: 'kPa',    mode: '01' },
  '010E': { label: 'Allumage',    unit: '°',       mode: '01' },
  '0110': { label: 'MAF',         unit: 'g/s',    mode: '01' },
  '0111': { label: 'Papillon',    unit: '%',       mode: '01' },
  '012F': { label: 'Carburant',   unit: '%',       mode: '01' },
};

function parseOBDResponse(pid: string, raw: string): string {
  try {
    const bytes = raw.trim().replace(/\s/g,'').replace(/^[0-9A-F]{2}/,'');
    const b = (n: number) => parseInt(bytes.slice(n*2,(n+1)*2), 16);
    switch(pid) {
      case '010C': return ((b(0)*256+b(1))/4).toFixed(0);
      case '010D': return b(0).toString();
      case '0105': return (b(0)-40).toString();
      case '010B': return b(0).toString();
      case '010E': return ((b(0)-128)/2).toFixed(1);
      case '0110': return ((b(0)*256+b(1))/100).toFixed(2);
      case '0111': return ((b(0)*100)/255).toFixed(1);
      case '012F': return ((b(0)*100)/255).toFixed(1);
      default: return raw.trim();
    }
  } catch { return '—'; }
}

export function useOBDBLE() {
  const [state, setState] = useState<OBDState>('idle');
  const [devices, setDevices] = useState<any[]>([]);
  const [connectedDevice, setConnectedDevice] = useState<any>(null);
  const [liveData, setLiveData] = useState<LiveData>({});
  const [dtcs, setDtcs] = useState<string[]>([]);
  const [error, setError] = useState<string>('');
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // NOTE: La vraie implémentation BLE nécessite react-native-bluetooth-classic
  // ou react-native-ble-plx installés via EAS Build (pas disponible dans Expo Go)
  // Ce hook prépare l'API pour quand le module sera disponible

  const scanDevices = useCallback(async () => {
    setState('scanning');
    setError('');
    try {
      // Simulation pour développement — remplacé par BLE réel avec EAS Build
      await new Promise(r => setTimeout(r, 2000));
      setDevices([
        { id: '00:04:3E:8C:85:2A', name: 'OBDLink MX+', rssi: -45 },
        { id: '00:04:3E:FF:AA:BB', name: 'MecaIA ONE BT', rssi: -62 },
      ]);
      setState('idle');
    } catch (e: any) {
      setError(e.message || 'Erreur scan BLE');
      setState('error');
    }
  }, []);

  const connect = useCallback(async (device: any) => {
    setState('connecting');
    try {
      await new Promise(r => setTimeout(r, 1500));
      setConnectedDevice(device);
      setState('connected');
      // Démarrer le polling des PIDs
      startPolling();
    } catch (e: any) {
      setError(e.message);
      setState('error');
    }
  }, []);

  const disconnect = useCallback(() => {
    if (pollRef.current) clearInterval(pollRef.current);
    setConnectedDevice(null);
    setLiveData({});
    setDtcs([]);
    setState('idle');
  }, []);

  function startPolling() {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      // Simulation de données — remplacé par vraies lectures OBD BLE
      setLiveData(prev => ({
        ...prev,
        RPM:      { value: (800 + Math.random()*200).toFixed(0), unit: 'tr/min', label: 'RPM' },
        SPEED:    { value: '0',  unit: 'km/h',  label: 'Vitesse' },
        COOLANT:  { value: (85 + Math.random()*5).toFixed(0), unit: '°C', label: 'Refroid.' },
        BATTERY:  { value: (12.3 + Math.random()*0.3).toFixed(2), unit: 'V', label: 'Batterie' },
        LTFT:     { value: (Math.random()*4-2).toFixed(1), unit: '%', label: 'LTFT B1' },
      }));
    }, 1000);
  }

  const readDTCs = useCallback(async () => {
    // TODO: Envoyer commande '03' via BLE → parser les codes P/B/C/U
    setDtcs([]);
  }, []);

  useEffect(() => {
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, []);

  return { state, devices, connectedDevice, liveData, dtcs, error, scanDevices, connect, disconnect, readDTCs };
}
