import * as DocumentPicker from 'expo-document-picker';
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

export interface PickedFile { uri: string; name: string; type: string }

/**
 * Ticket photos or PDFs, ready for a multipart `files` field. Several at once
 * from the library or as PDFs (one per guest); the camera takes one.
 */
export async function pickTicketFiles(from: 'camera' | 'library' | 'pdf'): Promise<PickedFile[]> {
  if (from === 'pdf') {
    const res = await DocumentPicker.getDocumentAsync({ type: ['application/pdf', 'image/*'], multiple: true, copyToCacheDirectory: true });
    if (res.canceled) return [];
    return res.assets.map((a, i) => ({ uri: a.uri, name: a.name || `ticket-${i + 1}.pdf`, type: a.mimeType || 'application/pdf' }));
  }
  const perm = from === 'camera' ? await ImagePicker.requestCameraPermissionsAsync() : await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!perm.granted) throw new Error(from === 'camera' ? 'Camera permission is needed.' : 'Photo access is needed.');
  const opts: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], quality: 0.6, allowsMultipleSelection: from === 'library', selectionLimit: 20 };
  const res = from === 'camera' ? await ImagePicker.launchCameraAsync(opts) : await ImagePicker.launchImageLibraryAsync(opts);
  if (res.canceled) return [];
  return (res.assets ?? []).map((a, i) => {
    const type = a.mimeType && a.mimeType !== 'image/heic' ? a.mimeType : 'image/jpeg';
    return { uri: a.uri, name: `ticket-${Date.now()}-${i + 1}.${type === 'image/png' ? 'png' : 'jpg'}`, type };
  });
}

export function filesForm(files: PickedFile[], fields: Record<string, string> = {}): FormData {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.append(k, v);
  // React Native's FormData takes a { uri, name, type } file descriptor.
  for (const f of files) form.append('files', f as unknown as Blob);
  return form;
}
