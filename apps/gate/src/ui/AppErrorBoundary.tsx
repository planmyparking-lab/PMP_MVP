import { Component, type PropsWithChildren } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { addLogLine } from "../lib/log";
import {
  stateAfterAppError,
  stateAfterAppErrorRetry,
  type AppErrorBoundaryState,
} from "../lib/errorBoundaryState";
import { translate } from "../i18n/config";
import { P } from "./ui";

export class AppErrorBoundary extends Component<PropsWithChildren, AppErrorBoundaryState> {
  state: AppErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): AppErrorBoundaryState {
    return stateAfterAppError();
  }

  componentDidCatch(): void {
    addLogLine("uncaught render error; safe fallback displayed", new Date().toISOString());
  }

  render() {
    if (this.state.hasError) {
      return (
        <SafeAreaView style={styles.screen}>
          <View style={styles.content}>
            <Text style={styles.message}>{translate("errors.appFallback")}</Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={translate("common.retry")}
              onPress={() => this.setState(stateAfterAppErrorRetry())}
              style={styles.button}
            >
              <Text style={styles.buttonText}>{translate("common.retry")}</Text>
            </Pressable>
          </View>
        </SafeAreaView>
      );
    }
    return this.props.children;
  }
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: P.bg, justifyContent: "center" },
  content: { padding: 24 },
  message: { color: P.text, fontSize: P.body, textAlign: "center" },
  button: {
    minHeight: P.touch,
    marginTop: 16,
    borderWidth: 1,
    borderColor: P.accent,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  buttonText: { color: P.accent, fontSize: P.body, fontWeight: "600" },
});
