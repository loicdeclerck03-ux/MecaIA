# MecaIA Mobile App

Application React Native (Expo) pour MecaIA — diagnostic automobile IA.

## Stack
- Expo SDK 51 + Expo Router v3
- React Native 0.74
- TypeScript
- Supabase (auth + data)

## Structure
```
app/
  _layout.tsx          # Root layout + auth redirect
  (auth)/
    login.tsx          # Login / Register
  (tabs)/
    _layout.tsx        # Tab navigation (5 tabs)
    dylan.tsx          # Chat Dylan IA
    garage.tsx         # Mes véhicules
    obd.tsx            # OBD2 live data
    sante.tsx          # Health score + alertes
    profil.tsx         # Profil + paramètres
lib/
  supabase.ts          # Client Supabase + authedFetch
```

## Lancer le projet

```bash
cd mobile
npm install
npx expo start
```

## Build production

```bash
# Android APK (local)
npx expo build:android

# iOS (EAS, compte Apple Dev requis)
eas build --platform ios
```

## Permissions Bluetooth

L'app utilise le Bluetooth Classic (RFCOMM) pour se connecter au boitier OBD2.
- Android : BLUETOOTH_CONNECT + BLUETOOTH_SCAN
- iOS : NSBluetoothAlwaysUsageDescription

Le module BLE sera intégré en phase 2 (semaine 9 du planning).
