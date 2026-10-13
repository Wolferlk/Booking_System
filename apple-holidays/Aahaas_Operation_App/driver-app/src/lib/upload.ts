import * as ImagePicker from 'expo-image-picker';
import { api } from './api';

/** Take a photo (or pick one) and upload it. Returns the server URL, or null if cancelled. */
export async function takeAndUpload(kind: 'vehicle' | 'profile' | 'odometer', from: 'camera' | 'library' = 'camera'): Promise<{ url: string; localUri: string } | null> {
  const perm = from === 'camera' ? await ImagePicker.requestCameraPermissionsAsync() : await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!perm.granted) throw new Error(from === 'camera' ? 'Camera permission is needed.' : 'Photo access is needed.');
  const opts: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], quality: 0.6, allowsEditing: kind === 'profile', aspect: kind === 'profile' ? [1, 1] : undefined };
  const res = from === 'camera' ? await ImagePicker.launchCameraAsync(opts) : await ImagePicker.launchImageLibraryAsync(opts);
  if (res.canceled || !res.assets?.[0]) return null;
  const a = res.assets[0];
  const type = a.mimeType && a.mimeType !== 'image/heic' ? a.mimeType : 'image/jpeg';
  const form = new FormData();
  form.append('kind', kind);
  // React Native's FormData takes a { uri, name, type } file descriptor.
  form.append('file', { uri: a.uri, name: `${kind}.${type === 'image/png' ? 'png' : 'jpg'}`, type } as unknown as Blob);
  const r = await api<{ url: string }>('/api/mobile/upload', { form });
  return { url: r.url, localUri: a.uri };
}
