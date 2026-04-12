import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import { UserProfile, Post, Job, Conversation, ChatMessage } from './types';

const KEYS = {
  PROFILE: 'repairhub_profile_v2',
  POSTS: 'repairhub_posts_v2',
  JOBS: 'repairhub_jobs_v2',
  ONBOARDED: 'repairhub_onboarded_v2',
  CONVERSATIONS: 'repairhub_conversations_v2',
  SESSION_TOKEN: 'mobi_session_token_v2',
};

export async function getProfile(): Promise<UserProfile | null> {
  const data = await AsyncStorage.getItem(KEYS.PROFILE);
  return data ? JSON.parse(data) : null;
}

export async function saveProfile(profile: UserProfile): Promise<void> {
  await AsyncStorage.setItem(KEYS.PROFILE, JSON.stringify(profile));
}

export async function isOnboarded(): Promise<boolean> {
  const val = await AsyncStorage.getItem(KEYS.ONBOARDED);
  return val === 'true';
}

export async function setOnboarded(): Promise<void> {
  await AsyncStorage.setItem(KEYS.ONBOARDED, 'true');
}

export async function getPosts(): Promise<Post[]> {
  const data = await AsyncStorage.getItem(KEYS.POSTS);
  const posts: Post[] = data ? JSON.parse(data) : [];
  return posts.sort((a, b) => b.createdAt - a.createdAt);
}

export async function savePost(post: Post): Promise<void> {
  const posts = await getPosts();
  posts.unshift(post);
  await AsyncStorage.setItem(KEYS.POSTS, JSON.stringify(posts));
}

export async function updatePost(updatedPost: Post): Promise<void> {
  const posts = await getPosts();
  const idx = posts.findIndex(p => p.id === updatedPost.id);
  if (idx !== -1) {
    posts[idx] = updatedPost;
    await AsyncStorage.setItem(KEYS.POSTS, JSON.stringify(posts));
  }
}

export async function deletePost(postId: string): Promise<void> {
  const posts = await getPosts();
  const filtered = posts.filter(p => p.id !== postId);
  await AsyncStorage.setItem(KEYS.POSTS, JSON.stringify(filtered));
}

export async function getJobs(): Promise<Job[]> {
  const data = await AsyncStorage.getItem(KEYS.JOBS);
  const jobs: Job[] = data ? JSON.parse(data) : [];
  return jobs.sort((a, b) => b.createdAt - a.createdAt);
}

export async function saveJob(job: Job): Promise<void> {
  const jobs = await getJobs();
  jobs.unshift(job);
  await AsyncStorage.setItem(KEYS.JOBS, JSON.stringify(jobs));
}

export async function getConversations(): Promise<Conversation[]> {
  const data = await AsyncStorage.getItem(KEYS.CONVERSATIONS);
  const convos: Conversation[] = data ? JSON.parse(data) : [];
  return convos.sort((a, b) => b.lastMessageAt - a.lastMessageAt);
}

export async function saveConversation(convo: Conversation): Promise<void> {
  const convos = await getConversations();
  const idx = convos.findIndex(c => c.id === convo.id);
  if (idx !== -1) {
    convos[idx] = convo;
  } else {
    convos.unshift(convo);
  }
  await AsyncStorage.setItem(KEYS.CONVERSATIONS, JSON.stringify(convos));
}

export async function deleteConversation(convoId: string): Promise<void> {
  const convos = await getConversations();
  const filtered = convos.filter(c => c.id !== convoId);
  await AsyncStorage.setItem(KEYS.CONVERSATIONS, JSON.stringify(filtered));
}

export async function seedDemoData(currentProfile: UserProfile): Promise<void> {
  const existingPosts = await getPosts();
  if (existingPosts.length > 0) return;

  const demoPosts: Post[] = [
    {
      id: 'post_welcome',
      userId: currentProfile.id,
      userName: currentProfile.name,
      userRole: currentProfile.role,
      text: `Hi everyone! I am ${currentProfile.name} from ${currentProfile.city || 'India'}. I just joined Mobi as a ${currentProfile.role === 'technician' ? 'Technician' : currentProfile.role === 'teacher' ? 'Teacher/Trainer' : currentProfile.role === 'supplier' ? 'Spare Parts Supplier' : 'Job Provider'}. ${currentProfile.skills.length > 0 ? 'My skills include ' + currentProfile.skills.join(', ') + '.' : ''} Looking forward to connecting with the repair community!`,
      images: [],
      category: 'repair',
      likes: ['demo1', 'demo2', 'demo3'],
      comments: [
        { id: 'c_welcome', userId: 'demo1', userName: 'Rajesh Kumar', text: `Welcome to Mobi, ${currentProfile.name}! Great to have you here.`, createdAt: Date.now() - 500000 },
      ],
      createdAt: Date.now() - 600000,
    },
    {
      id: 'post1',
      userId: 'demo1',
      userName: 'Rajesh Kumar',
      userRole: 'technician',
      text: 'Successfully repaired iPhone 15 Pro with water damage. The logic board needed micro-soldering on 3 components. Always check for corrosion under the shields!',
      images: [],
      category: 'repair',
      likes: ['demo2', 'demo3'],
      comments: [
        { id: 'c1', userId: 'demo2', userName: 'Priya Sharma', text: 'Great work! Which flux did you use?', createdAt: Date.now() - 3500000 },
      ],
      createdAt: Date.now() - 3600000,
    },
    {
      id: 'post2',
      userId: 'demo2',
      userName: 'Priya Sharma',
      userRole: 'teacher',
      text: 'New batch starting for Advanced PCB Repair course! 30-day intensive program covering BGA rework, micro-soldering, and schematic reading. Limited seats available.',
      images: [],
      category: 'training',
      likes: ['demo1'],
      comments: [],
      createdAt: Date.now() - 7200000,
    },
    {
      id: 'post3',
      userId: 'demo3',
      userName: 'Amit Patel',
      userRole: 'supplier',
      text: 'Fresh stock arrived! Samsung Galaxy S24 Ultra original displays, batteries, and charging ports. Wholesale prices for bulk orders. DM for price list.',
      images: [],
      category: 'supplier',
      likes: ['demo1', 'demo4'],
      comments: [
        { id: 'c2', userId: 'demo1', userName: 'Rajesh Kumar', text: 'What is the price for S24 Ultra display?', createdAt: Date.now() - 6500000 },
      ],
      createdAt: Date.now() - 10800000,
    },
    {
      id: 'post4',
      userId: 'demo4',
      userName: 'Sunita Verma',
      userRole: 'job_provider',
      text: 'Hiring experienced AC technicians for our service center in Bangalore. VRF/VRV experience preferred. Salary: 25k-40k + incentives. Apply now!',
      images: [],
      category: 'job',
      likes: [],
      comments: [],
      createdAt: Date.now() - 14400000,
    },
    {
      id: 'post5',
      userId: 'demo1',
      userName: 'Rajesh Kumar',
      userRole: 'technician',
      text: 'Tip for beginners: Always use an anti-static wrist strap when working on motherboards. I have seen too many boards damaged by static discharge. Safety first!',
      images: [],
      category: 'repair',
      likes: ['demo2', 'demo3', 'demo4'],
      comments: [
        { id: 'c3', userId: 'demo2', userName: 'Priya Sharma', text: 'Absolutely essential! I teach this on day one of every course.', createdAt: Date.now() - 13000000 },
      ],
      createdAt: Date.now() - 18000000,
    },
  ];

  const demoJobs: Job[] = [
    {
      id: 'job1',
      userId: 'demo4',
      userName: 'Sunita Verma',
      title: 'AC Technician - Service Center',
      description: 'Looking for experienced AC technicians for installation and repair. VRF/VRV experience preferred.',
      city: 'Bangalore',
      state: 'Karnataka',
      skills: ['AC Repair'],
      salary: '25,000 - 40,000/month',
      type: 'full_time',
      createdAt: Date.now() - 14400000,
    },
    {
      id: 'job2',
      userId: 'demo1',
      userName: 'Rajesh Kumar',
      title: 'Mobile Repair Intern',
      description: 'Learn mobile repair from scratch. 3-month internship with hands-on training on all major brands.',
      city: 'Mumbai',
      state: 'Maharashtra',
      skills: ['Mobile Repair'],
      salary: '10,000 - 15,000/month',
      type: 'part_time',
      createdAt: Date.now() - 86400000,
    },
  ];

  const demoConversations: Conversation[] = [
    {
      id: 'convo_demo1',
      participantIds: [currentProfile.id, 'demo1'],
      participantNames: [currentProfile.name, 'Rajesh Kumar'],
      participantRoles: [currentProfile.role, 'technician'],
      lastMessage: 'Hey, can you help me with a mobile repair issue?',
      lastMessageAt: Date.now() - 1800000,
      unreadCount: 1,
      messages: [
        { id: 'msg1', senderId: 'demo1', senderName: 'Rajesh Kumar', text: 'Welcome to Mobi! Feel free to ask anything about mobile repair.', createdAt: Date.now() - 3600000 },
        { id: 'msg2', senderId: currentProfile.id, senderName: currentProfile.name, text: 'Thanks! I have a question about iPhone screen replacement.', createdAt: Date.now() - 2700000 },
        { id: 'msg3', senderId: 'demo1', senderName: 'Rajesh Kumar', text: 'Sure! What model are you working on? Each model has different connector types.', createdAt: Date.now() - 1800000 },
      ],
    },
    {
      id: 'convo_demo2',
      participantIds: [currentProfile.id, 'demo2'],
      participantNames: [currentProfile.name, 'Priya Sharma'],
      participantRoles: [currentProfile.role, 'teacher'],
      lastMessage: 'The next PCB repair batch starts Monday!',
      lastMessageAt: Date.now() - 7200000,
      unreadCount: 0,
      messages: [
        { id: 'msg4', senderId: currentProfile.id, senderName: currentProfile.name, text: 'Hi, I am interested in your PCB repair course.', createdAt: Date.now() - 10800000 },
        { id: 'msg5', senderId: 'demo2', senderName: 'Priya Sharma', text: 'Great! We cover BGA rework, micro-soldering, and schematic reading.', createdAt: Date.now() - 9000000 },
        { id: 'msg6', senderId: 'demo2', senderName: 'Priya Sharma', text: 'The next PCB repair batch starts Monday!', createdAt: Date.now() - 7200000 },
      ],
    },
    {
      id: 'convo_demo3',
      participantIds: [currentProfile.id, 'demo3'],
      participantNames: [currentProfile.name, 'Amit Patel'],
      participantRoles: [currentProfile.role, 'supplier'],
      lastMessage: 'I can offer 15% discount on bulk display orders.',
      lastMessageAt: Date.now() - 14400000,
      unreadCount: 1,
      messages: [
        { id: 'msg7', senderId: currentProfile.id, senderName: currentProfile.name, text: 'Do you have Samsung S24 Ultra displays in stock?', createdAt: Date.now() - 18000000 },
        { id: 'msg8', senderId: 'demo3', senderName: 'Amit Patel', text: 'Yes! We have original and aftermarket options.', createdAt: Date.now() - 16200000 },
        { id: 'msg9', senderId: 'demo3', senderName: 'Amit Patel', text: 'I can offer 15% discount on bulk display orders.', createdAt: Date.now() - 14400000 },
      ],
    },
  ];

  await AsyncStorage.setItem(KEYS.POSTS, JSON.stringify(demoPosts));
  await AsyncStorage.setItem(KEYS.JOBS, JSON.stringify(demoJobs));
  await AsyncStorage.setItem(KEYS.CONVERSATIONS, JSON.stringify(demoConversations));
}

export async function saveSessionToken(token: string): Promise<void> {
  // On web, use localStorage for better persistence
  if (Platform.OS === 'web' && typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(KEYS.SESSION_TOKEN, token);
  }
  await AsyncStorage.setItem(KEYS.SESSION_TOKEN, token);
}

export async function getSessionToken(): Promise<string | null> {
  // On web, try localStorage first (more reliable)
  if (Platform.OS === 'web' && typeof window !== 'undefined' && window.localStorage) {
    const token = window.localStorage.getItem(KEYS.SESSION_TOKEN);
    if (token) return token;
  }
  return await AsyncStorage.getItem(KEYS.SESSION_TOKEN);
}

export async function clearSessionToken(): Promise<void> {
  if (Platform.OS === 'web' && typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.removeItem(KEYS.SESSION_TOKEN);
  }
  await AsyncStorage.removeItem(KEYS.SESSION_TOKEN);
}

export async function clearAll(): Promise<void> {
  await AsyncStorage.multiRemove([
    KEYS.PROFILE,
    KEYS.POSTS,
    KEYS.JOBS,
    KEYS.ONBOARDED,
    KEYS.CONVERSATIONS,
    KEYS.SESSION_TOKEN,
  ]);
}

export async function ensureWelcomePost(currentProfile: UserProfile): Promise<boolean> {
  const posts = await getPosts();
  const hasWelcome = posts.some(p => p.id === 'post_welcome' || (p.userId === currentProfile.id));
  if (hasWelcome) return false;

  const welcomePost: Post = {
    id: 'post_welcome',
    userId: currentProfile.id,
    userName: currentProfile.name,
    userRole: currentProfile.role,
    text: `Hi everyone! I am ${currentProfile.name} from ${currentProfile.city || 'India'}. I just joined Mobi as a ${currentProfile.role === 'technician' ? 'Technician' : currentProfile.role === 'teacher' ? 'Teacher/Trainer' : currentProfile.role === 'supplier' ? 'Spare Parts Supplier' : 'Job Provider'}. ${currentProfile.skills.length > 0 ? 'My skills include ' + currentProfile.skills.join(', ') + '.' : ''} Looking forward to connecting with the repair community!`,
    images: [],
    category: 'repair',
    likes: ['demo1', 'demo2', 'demo3'],
    comments: [
      { id: 'c_welcome', userId: 'demo1', userName: 'Rajesh Kumar', text: `Welcome to Mobi, ${currentProfile.name}! Great to have you here.`, createdAt: Date.now() - 500000 },
    ],
    createdAt: Date.now() - 600000,
  };

  posts.unshift(welcomePost);
  await AsyncStorage.setItem(KEYS.POSTS, JSON.stringify(posts));
  return true;
}
