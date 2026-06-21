// app/(tabs)/_layout.tsx — Navigation 5 tabs MecaIA Mobile
import { Tabs } from 'expo-router';
import { View, Text } from 'react-native';
import { COLORS } from '../_layout';

function TabIcon({ focused, emoji, label }: { focused: boolean; emoji: string; label: string }) {
  return (
    <View style={{ alignItems: 'center', gap: 2 }}>
      <Text style={{ fontSize: 20 }}>{emoji}</Text>
      <Text style={{ fontSize: 9, color: focused ? COLORS.accent : COLORS.muted, fontWeight: focused ? '600' : '400' }}>
        {label}
      </Text>
    </View>
  );
}

export default function TabLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarStyle: {
          backgroundColor: '#08080a',
          borderTopColor: COLORS.border,
          borderTopWidth: 0.5,
          height: 78,
          paddingBottom: 12,
        },
        tabBarShowLabel: false,
        tabBarActiveTintColor: COLORS.accent,
        tabBarInactiveTintColor: COLORS.muted,
      }}
    >
      <Tabs.Screen
        name="dylan"
        options={{ tabBarIcon: ({ focused }) => <TabIcon focused={focused} emoji="🤖" label="Dylan" /> }}
      />
      <Tabs.Screen
        name="garage"
        options={{ tabBarIcon: ({ focused }) => <TabIcon focused={focused} emoji="🚗" label="Garage" /> }}
      />
      <Tabs.Screen
        name="obd"
        options={{ tabBarIcon: ({ focused }) => <TabIcon focused={focused} emoji="🔌" label="OBD" /> }}
      />
      <Tabs.Screen
        name="sante"
        options={{ tabBarIcon: ({ focused }) => <TabIcon focused={focused} emoji="📊" label="Santé" /> }}
      />
      <Tabs.Screen
        name="profil"
        options={{ tabBarIcon: ({ focused }) => <TabIcon focused={focused} emoji="👤" label="Profil" /> }}
      />
    </Tabs>
  );
}
