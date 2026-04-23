// Shared GIF picker using KLIPY API (WhatsApp-style trending + search).
// Used on ChatRoomScreen, GroupChatScreen, ActivityChatScreen.

import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  Modal,
  TouchableOpacity,
  TextInput,
  FlatList,
  Image,
  ActivityIndicator,
  StyleSheet,
  Pressable,
  Keyboard,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../Screens/context/ThemeContext';
import { fetchFeaturedGifs, searchGifs, TenorGif } from '../services/tenor';
import { primeKlipyKeyFromFirebase } from '../services/klipy';

const LIMIT = 24;
const SEARCH_DEBOUNCE_MS = 400;

interface GifStickerPickerProps {
  visible: boolean;
  onClose: () => void;
  onSelectGif: (gifUrl: string) => void;
}

export default function GifStickerPicker({ visible, onClose, onSelectGif }: GifStickerPickerProps) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const [gifs, setGifs] = useState<TenorGif[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [nextPos, setNextPos] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadFeatured = useCallback(async (pos?: string) => {
    setError(null);
    if (!pos) setLoading(true);
    else setLoadingMore(true);
    try {
      const { gifs: list, next } = await fetchFeaturedGifs(LIMIT, pos);
      if (!pos) setGifs(list);
      else setGifs((prev) => [...prev, ...list]);
      setNextPos(next);
      if (!pos && list.length === 0) {
        setError(
          'No GIFs loaded. Set EXPO_PUBLIC_KLIPY_API_KEY in .env or add klipy_api_key in Firebase Remote Config (or deploy getKlipyTrending with KLIPY_SECRET).'
        );
      }
    } catch (e: any) {
      setError(e?.message || 'Failed to load GIFs');
      if (!pos) setGifs([]);
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, []);

  const runSearch = useCallback(async (q: string, pos?: string) => {
    setError(null);
    if (!pos) setLoading(true);
    else setLoadingMore(true);
    try {
      const { gifs: list, next } = await searchGifs(q, LIMIT, pos);
      if (!pos) setGifs(list);
      else setGifs((prev) => [...prev, ...list]);
      setNextPos(next);
      if (!pos && list.length === 0 && q.trim()) {
        setError('No GIFs found for this search.');
      }
    } catch (e: any) {
      setError(e?.message || 'Search failed');
      if (!pos) setGifs([]);
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, []);

  // Initial load when modal opens (prime Remote Config key then load)
  useEffect(() => {
    if (visible) {
      setSearchQuery('');
      setNextPos(null);
      setError(null);
      (async () => {
        await primeKlipyKeyFromFirebase();
        loadFeatured();
      })();
    }
  }, [visible, loadFeatured]);

  // Debounced search when query changes
  useEffect(() => {
    if (!visible) return;
    const q = searchQuery.trim();
    if (q === '') {
      loadFeatured();
      return;
    }
    const t = setTimeout(() => {
      setNextPos(null);
      runSearch(q);
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [searchQuery, visible, loadFeatured, runSearch]);

  const loadMore = useCallback(() => {
    if (loadingMore || !nextPos) return;
    if (searchQuery.trim()) runSearch(searchQuery.trim(), nextPos);
    else loadFeatured(nextPos);
  }, [loadingMore, nextPos, searchQuery, loadFeatured, runSearch]);

  const handleSelect = (gif: TenorGif) => {
    Keyboard.dismiss();
    onSelectGif(gif.url);
    onClose();
  };

  const styles = StyleSheet.create({
    overlay: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.5)',
      justifyContent: 'flex-end',
    },
    sheet: {
      backgroundColor: colors.background,
      borderTopLeftRadius: 16,
      borderTopRightRadius: 16,
      paddingBottom: insets.bottom + 16,
      maxHeight: '80%',
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 16,
      paddingVertical: 12,
      borderBottomWidth: 1,
      borderBottomColor: colors.borderColor,
    },
    title: {
      fontSize: 18,
      fontWeight: '600',
      color: colors.text,
    },
    searchRow: {
      flexDirection: 'row',
      alignItems: 'center',
      marginHorizontal: 16,
      marginTop: 12,
      marginBottom: 8,
      backgroundColor: colors.inputBg || colors.surface,
      borderRadius: 12,
      paddingHorizontal: 12,
      paddingVertical: 8,
    },
    searchInput: {
      flex: 1,
      fontSize: 16,
      color: colors.text,
      paddingVertical: 4,
      marginLeft: 8,
    },
    list: {
      paddingHorizontal: 8,
    },
    listContent: {
      paddingBottom: 24,
    },
    gifWrap: {
      width: '33.33%',
      padding: 4,
      aspectRatio: 1,
    },
    gifImage: {
      width: '100%',
      height: '100%',
      borderRadius: 8,
      backgroundColor: colors.borderColor,
    },
    footer: {
      paddingVertical: 12,
      alignItems: 'center',
    },
    error: {
      color: colors.error,
      fontSize: 14,
      paddingHorizontal: 16,
      paddingVertical: 12,
      textAlign: 'center',
    },
  });

  if (!visible) return null;

  return (
    <Modal transparent visible={visible} animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.overlay} onPress={onClose}>
        <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
          <View style={styles.header}>
            <Text style={styles.title}>GIFs & Stickers</Text>
            <TouchableOpacity onPress={onClose} hitSlop={12}>
              <Ionicons name="close" size={28} color={colors.text} />
            </TouchableOpacity>
          </View>
          <View style={styles.searchRow}>
            <Ionicons name="search" size={22} color={colors.secondaryText} />
            <TextInput
              style={styles.searchInput}
              value={searchQuery}
              onChangeText={setSearchQuery}
              placeholder="Search GIFs..."
              placeholderTextColor={colors.placeholderText}
              returnKeyType="search"
            />
            {searchQuery.length > 0 && (
              <TouchableOpacity onPress={() => setSearchQuery('')}>
                <Ionicons name="close-circle" size={22} color={colors.secondaryText} />
              </TouchableOpacity>
            )}
          </View>
          {error ? (
            <Text style={styles.error}>{error}</Text>
          ) : loading && gifs.length === 0 ? (
            <View style={{ paddingVertical: 48, alignItems: 'center' }}>
              <ActivityIndicator size="large" color={colors.primary} />
            </View>
          ) : (
            <FlatList
              data={gifs}
              keyExtractor={(item) => item.id}
              numColumns={3}
              style={styles.list}
              contentContainerStyle={styles.listContent}
              onEndReached={loadMore}
              onEndReachedThreshold={0.3}
              ListFooterComponent={
                loadingMore ? (
                  <View style={styles.footer}>
                    <ActivityIndicator size="small" color={colors.primary} />
                  </View>
                ) : null
              }
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={styles.gifWrap}
                  activeOpacity={0.8}
                  onPress={() => handleSelect(item)}
                >
                  <Image source={{ uri: item.tinyUrl }} style={styles.gifImage} resizeMode="cover" />
                </TouchableOpacity>
              )}
            />
          )}
        </Pressable>
      </Pressable>
    </Modal>
  );
}
