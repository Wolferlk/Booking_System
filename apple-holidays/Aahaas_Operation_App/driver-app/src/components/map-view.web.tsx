/**
 * Web stand-in for react-native-maps (it only ships native code, and importing it
 * on web crashes the bundle). Same exports, so screens import from here unchanged.
 */
import { Component, type ReactNode } from 'react';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

export default class MapView extends Component<{ style?: StyleProp<ViewStyle>; children?: ReactNode }> {
  animateCamera() {}
  fitToCoordinates() {}
  render() {
    return (
      <View style={[styles.box, this.props.style]}>
        <Text style={styles.text}>The map is available in the mobile app.</Text>
      </View>
    );
  }
}

export function Marker(_: object) { return null; }
export function Polyline(_: object) { return null; }

const styles = StyleSheet.create({
  box: { backgroundColor: '#0B1739', alignItems: 'center', justifyContent: 'center', padding: 16 },
  text: { color: '#93C5FD', fontWeight: '700', textAlign: 'center' },
});
