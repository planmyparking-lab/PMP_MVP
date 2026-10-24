import { StatusBar } from "expo-status-bar";
import { StyleSheet, Text, View } from "react-native";
import { SCHEMA_VERSION } from "@pmp/contracts";

// Placeholder shell. Real screens are tracked as GATE-xx features in docs/team/member-02-nikhil.md.
export default function App() {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>ParkOS Gate</Text>
      <Text>Schema version {SCHEMA_VERSION}</Text>
      <StatusBar style="auto" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#fff", alignItems: "center", justifyContent: "center" },
  title: { fontSize: 24, fontWeight: "600" },
});
