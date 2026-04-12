import React from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Colors from '@/constants/colors';
import { Job } from '@/lib/types';

const C = Colors.dark;

const JOB_TYPE_LABELS: Record<string, string> = {
  full_time: 'Full Time',
  part_time: 'Part Time',
  contract: 'Contract',
};

function timeAgo(ts: number): string {
  const diff = Date.now() - ts;
  const hrs = Math.floor(diff / 3600000);
  if (hrs < 1) return 'Just now';
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

export default function JobCard({ job }: { job: Job }) {
  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <View style={styles.iconContainer}>
          <Ionicons name="briefcase" size={22} color="#5E8BFF" />
        </View>
        <View style={styles.headerInfo}>
          <Text style={styles.title} numberOfLines={2}>{job.title}</Text>
          <Text style={styles.poster}>by {job.userName}</Text>
        </View>
      </View>

      <Text style={styles.description} numberOfLines={3}>{job.description}</Text>

      <View style={styles.details}>
        <View style={styles.detailItem}>
          <Ionicons name="location-outline" size={14} color={C.textSecondary} />
          <Text style={styles.detailText}>{job.city}, {job.state}</Text>
        </View>
        <View style={styles.detailItem}>
          <Ionicons name="time-outline" size={14} color={C.textSecondary} />
          <Text style={styles.detailText}>{JOB_TYPE_LABELS[job.type]}</Text>
        </View>
        {job.salary && (
          <View style={styles.detailItem}>
            <Ionicons name="cash-outline" size={14} color={C.textSecondary} />
            <Text style={styles.detailText}>{job.salary}</Text>
          </View>
        )}
      </View>

      <View style={styles.footer}>
        <View style={styles.skillsRow}>
          {job.skills.slice(0, 2).map((s, i) => (
            <View key={i} style={styles.skillTag}>
              <Text style={styles.skillText}>{s}</Text>
            </View>
          ))}
        </View>
        <Text style={styles.time}>{timeAgo(job.createdAt)}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: C.surface,
    borderRadius: 16,
    padding: 16,
    marginHorizontal: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: C.border,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 10,
  },
  iconContainer: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: 'rgba(94, 139, 255, 0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerInfo: {
    flex: 1,
    marginLeft: 12,
  },
  title: {
    color: C.text,
    fontSize: 16,
    fontFamily: 'Inter_600SemiBold',
    lineHeight: 22,
  },
  poster: {
    color: C.textTertiary,
    fontSize: 13,
    fontFamily: 'Inter_400Regular',
    marginTop: 2,
  },
  description: {
    color: C.textSecondary,
    fontSize: 13,
    fontFamily: 'Inter_400Regular',
    lineHeight: 19,
    marginBottom: 12,
  },
  details: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    marginBottom: 12,
  },
  detailItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  detailText: {
    color: C.textSecondary,
    fontSize: 12,
    fontFamily: 'Inter_400Regular',
  },
  footer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderTopWidth: 1,
    borderTopColor: C.borderLight,
    paddingTop: 10,
  },
  skillsRow: {
    flexDirection: 'row',
    gap: 6,
  },
  skillTag: {
    backgroundColor: 'rgba(94, 139, 255, 0.12)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  skillText: {
    color: '#5E8BFF',
    fontSize: 11,
    fontFamily: 'Inter_500Medium',
  },
  time: {
    color: C.textTertiary,
    fontSize: 12,
    fontFamily: 'Inter_400Regular',
  },
});
