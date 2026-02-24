import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Image,
  StyleSheet,
  Alert,
} from 'react-native';
import { RouteProp, useRoute, useNavigation } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import { RootStackParamList } from '../../types';
import { db, auth } from '../../firebaseConfig';
import { doc, getDoc } from 'firebase/firestore';
import { useTheme } from '../context/ThemeContext';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

type ActivityDetailScreenRouteProp = RouteProp<RootStackParamList, 'ActivityDetailScreen'>;
type ActivityDetailScreenNavigationProp = StackNavigationProp<RootStackParamList, 'ActivityDetailScreen'>;

type ActivityType = 'food-and-drinks' | 'night-life' | 'outdoor' | 'sightseeing' | 'entertainment' | 'shopping' | 'wellness' | 'social' | 'fitness' | 'other';

interface ActivityData {
  id: string;
  title: string;
  description?: string;
  activityType: ActivityType;
  latitude: number;
  longitude: number;
  location?: string;
  createdBy: string;
  createdByName: string;
  participants: string[];
  maxParticipants?: number;
  startTime?: any;
  endTime?: any;
}

interface MemberData {
  userId: string;
  username: string;
  profilePic?: string;
}

const getActivityTypeLabel = (type: ActivityType): string => {
  const labels: Record<string, string> = {
    'food-and-drinks': 'Food and Drinks',
    'night-life': 'Night life',
    'outdoor': 'Outdoor',
    'sightseeing': 'Sightseeing',
    'entertainment': 'Entertainment',
    'shopping': 'Shopping',
    'wellness': 'Wellness',
    'social': 'Social',
    'fitness': 'Fitness',
    'other': 'Other',
  };
  return labels[type] ?? 'Other';
};

const formatDateTime = (t: any): string => {
  if (!t) return '';
  try {
    const date = t?.toDate ? t.toDate() : new Date(t.seconds * 1000);
    return date.toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' });
  } catch {
    return '';
  }
};

export default function ActivityDetailScreen() {
  const route = useRoute<ActivityDetailScreenRouteProp>();
  const navigation = useNavigation<ActivityDetailScreenNavigationProp>();
  const { activityId } = route.params;
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();

  const [activity, setActivity] = useState<ActivityData | null>(null);
  const [members, setMembers] = useState<MemberData[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const activitySnap = await getDoc(doc(db, 'activities', activityId));
        if (!activitySnap.exists()) {
          Alert.alert('Error', 'Activity not found.');
          navigation.goBack();
          return;
        }
        const data = activitySnap.data();
        const activityData: ActivityData = {
          id: activitySnap.id,
          title: data?.title ?? '',
          description: data?.description,
          activityType: (data?.activityType as ActivityType) ?? 'other',
          latitude: data?.latitude ?? 0,
          longitude: data?.longitude ?? 0,
          location: data?.location,
          createdBy: data?.createdBy ?? '',
          createdByName: data?.createdByName ?? 'Unknown',
          participants: data?.participants ?? [],
          maxParticipants: data?.maxParticipants,
          startTime: data?.startTime,
          endTime: data?.endTime,
        };
        setActivity(activityData);

        const participantIds = activityData.participants || [];
        const memberList: MemberData[] = [];
        await Promise.all(
          participantIds.map(async (uid) => {
            try {
              const userSnap = await getDoc(doc(db, 'users', uid));
              if (userSnap.exists()) {
                const d = userSnap.data();
                memberList.push({
                  userId: uid,
                  username: d?.username || d?.displayName || 'User',
                  profilePic: d?.profilePic,
                });
              } else {
                memberList.push({ userId: uid, username: 'User' });
              }
            } catch {
              memberList.push({ userId: uid, username: 'User' });
            }
          })
        );
        setMembers(memberList);
      } catch (e) {
        console.error('Could not load activity', e);
        navigation.goBack();
      } finally {
        setLoading(false);
      }
    })();
  }, [activityId, navigation]);

  if (loading) {
    return (
      <View style={[styles.centered, { backgroundColor: colors.background }]}>
        <ActivityIndicator size="large" color={colors.primary} />
        <Text style={[styles.loadingText, { color: colors.text }]}>Loading...</Text>
      </View>
    );
  }

  if (!activity) return null;

  return (
    <View style={[styles.container, { backgroundColor: colors.background, paddingTop: insets.top }]}>
      <View style={[styles.header, { borderBottomColor: colors.borderColor }]}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.headerBack}>
          <Ionicons name="arrow-back" size={24} color={colors.text} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.text }]} numberOfLines={1}>
          Activity details
        </Text>
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + 24 }]}
        showsVerticalScrollIndicator={false}
      >
        <View style={[styles.card, { backgroundColor: colors.card }]}>
          <Text style={[styles.title, { color: colors.text }]}>{activity.title}</Text>
          <View style={styles.row}>
            <Ionicons name="pricetag-outline" size={18} color={colors.primary} />
            <Text style={[styles.label, { color: colors.textSecondary }]}>{getActivityTypeLabel(activity.activityType)}</Text>
          </View>
          {activity.location ? (
            <View style={styles.row}>
              <Ionicons name="location-outline" size={18} color={colors.textSecondary} />
              <Text style={[styles.value, { color: colors.text }]} numberOfLines={2}>{activity.location}</Text>
            </View>
          ) : null}
          {activity.startTime ? (
            <View style={styles.row}>
              <Ionicons name="calendar-outline" size={18} color={colors.textSecondary} />
              <Text style={[styles.value, { color: colors.text }]}>
                Start: {formatDateTime(activity.startTime)}
              </Text>
            </View>
          ) : null}
          {activity.endTime ? (
            <View style={styles.row}>
              <Ionicons name="time-outline" size={18} color={colors.textSecondary} />
              <Text style={[styles.value, { color: colors.text }]}>
                End: {formatDateTime(activity.endTime)}
              </Text>
            </View>
          ) : null}
          <View style={styles.row}>
            <Ionicons name="person-outline" size={18} color={colors.textSecondary} />
            <Text style={[styles.value, { color: colors.text }]}>
              Created by {activity.createdByName}
            </Text>
          </View>
        </View>

        <Text style={[styles.sectionTitle, { color: colors.text }]}>Members ({members.length})</Text>
        <View style={[styles.membersCard, { backgroundColor: colors.card }]}>
          {members.map((member) => (
            <TouchableOpacity
              key={member.userId}
              style={[styles.memberRow, { borderBottomColor: colors.borderColor }]}
              onPress={() => navigation.navigate('UserProfileScreen', { userId: member.userId })}
              activeOpacity={0.7}
            >
              {member.profilePic ? (
                <Image source={{ uri: member.profilePic }} style={styles.memberAvatar} />
              ) : (
                <View style={[styles.memberAvatar, styles.memberAvatarFallback]}>
                  <Text style={styles.memberAvatarText}>
                    {(member.username || '?').split(' ').map((n) => n[0]).join('').substring(0, 2).toUpperCase() || '?'}
                  </Text>
                </View>
              )}
              <Text style={[styles.memberName, { color: colors.text }]} numberOfLines={1}>
                {member.username}
              </Text>
              {member.userId === auth.currentUser?.uid && (
                <Text style={[styles.youBadge, { color: colors.primary }]}>You</Text>
              )}
              <Ionicons name="chevron-forward" size={20} color={colors.textSecondary} />
            </TouchableOpacity>
          ))}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  loadingText: { marginTop: 8, fontSize: 16 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderBottomWidth: 1,
  },
  headerBack: { padding: 4, marginRight: 8 },
  headerTitle: { flex: 1, fontSize: 18, fontWeight: '600' },
  scroll: { flex: 1 },
  scrollContent: { padding: 16, paddingTop: 20 },
  card: {
    borderRadius: 12,
    padding: 16,
    marginBottom: 24,
  },
  title: { fontSize: 20, fontWeight: '700', marginBottom: 12 },
  row: { flexDirection: 'row', alignItems: 'center', marginBottom: 10, gap: 8 },
  label: { fontSize: 14 },
  value: { flex: 1, fontSize: 14 },
  sectionTitle: { fontSize: 16, fontWeight: '600', marginBottom: 12 },
  membersCard: { borderRadius: 12, overflow: 'hidden' },
  memberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
    borderBottomWidth: 1,
  },
  memberAvatar: { width: 44, height: 44, borderRadius: 22, marginRight: 12 },
  memberAvatarFallback: {
    backgroundColor: '#94a3b8',
    justifyContent: 'center',
    alignItems: 'center',
  },
  memberAvatarText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  memberName: { flex: 1, fontSize: 16, fontWeight: '500' },
  youBadge: { fontSize: 12, fontWeight: '600', marginRight: 8 },
});
