export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.1"
  }
  public: {
    Tables: {
      agent_audit_log: {
        Row: {
          created_at: string
          error_message: string | null
          execution_time_ms: number | null
          id: string
          permission_decision: string | null
          permission_reason: string | null
          session_id: string | null
          tool_input: Json | null
          tool_name: string
          tool_output: Json | null
          user_id: string
        }
        Insert: {
          created_at?: string
          error_message?: string | null
          execution_time_ms?: number | null
          id?: string
          permission_decision?: string | null
          permission_reason?: string | null
          session_id?: string | null
          tool_input?: Json | null
          tool_name: string
          tool_output?: Json | null
          user_id: string
        }
        Update: {
          created_at?: string
          error_message?: string | null
          execution_time_ms?: number | null
          id?: string
          permission_decision?: string | null
          permission_reason?: string | null
          session_id?: string | null
          tool_input?: Json | null
          tool_name?: string
          tool_output?: Json | null
          user_id?: string
        }
        Relationships: []
      }
      conversation_messages: {
        Row: {
          attachments: Json | null
          content: string
          conversation_id: string
          created_at: string
          id: string
          is_complete: boolean | null
          metadata: Json | null
          model_id: string | null
          role: Database["public"]["Enums"]["message_role"]
          tokens_used: number | null
          tool_calls: Json | null
          user_id: string
        }
        Insert: {
          attachments?: Json | null
          content: string
          conversation_id: string
          created_at?: string
          id?: string
          is_complete?: boolean | null
          metadata?: Json | null
          model_id?: string | null
          role: Database["public"]["Enums"]["message_role"]
          tokens_used?: number | null
          tool_calls?: Json | null
          user_id: string
        }
        Update: {
          attachments?: Json | null
          content?: string
          conversation_id?: string
          created_at?: string
          id?: string
          is_complete?: boolean | null
          metadata?: Json | null
          model_id?: string | null
          role?: Database["public"]["Enums"]["message_role"]
          tokens_used?: number | null
          tool_calls?: Json | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "conversation_messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversation_messages_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      conversations: {
        Row: {
          created_at: string
          id: string
          message_count: number | null
          project_id: string | null
          sdk_session_id: string | null
          status: Database["public"]["Enums"]["conversation_status"] | null
          summary: string | null
          title: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          message_count?: number | null
          project_id?: string | null
          sdk_session_id?: string | null
          status?: Database["public"]["Enums"]["conversation_status"] | null
          summary?: string | null
          title?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          message_count?: number | null
          project_id?: string | null
          sdk_session_id?: string | null
          status?: Database["public"]["Enums"]["conversation_status"] | null
          summary?: string | null
          title?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "conversations_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversations_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      file_commit_files: {
        Row: {
          action: string
          commit_id: string
          content_type: string | null
          id: string
          path: string
          size: number | null
        }
        Insert: {
          action: string
          commit_id: string
          content_type?: string | null
          id?: string
          path: string
          size?: number | null
        }
        Update: {
          action?: string
          commit_id?: string
          content_type?: string | null
          id?: string
          path?: string
          size?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "file_commit_files_commit_id_fkey"
            columns: ["commit_id"]
            isOneToOne: false
            referencedRelation: "file_commits"
            referencedColumns: ["id"]
          },
        ]
      }
      file_commits: {
        Row: {
          created_at: string
          id: string
          message: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          message: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          message?: string
          user_id?: string
        }
        Relationships: []
      }
      knowledge_embeddings: {
        Row: {
          content: string
          content_type: string
          created_at: string
          embedding: string | null
          id: string
          meta: Json | null
          project_id: string | null
          source_id: string | null
          source_table: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          content: string
          content_type: string
          created_at?: string
          embedding?: string | null
          id?: string
          meta?: Json | null
          project_id?: string | null
          source_id?: string | null
          source_table?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          content?: string
          content_type?: string
          created_at?: string
          embedding?: string | null
          id?: string
          meta?: Json | null
          project_id?: string | null
          source_id?: string | null
          source_table?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "knowledge_embeddings_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      messages: {
        Row: {
          content: string
          created_at: string
          id: string
          room_id: string
          user_id: string
        }
        Insert: {
          content: string
          created_at?: string
          id?: string
          room_id: string
          user_id: string
        }
        Update: {
          content?: string
          created_at?: string
          id?: string
          room_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "messages_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "rooms"
            referencedColumns: ["id"]
          },
        ]
      }
      note_versions: {
        Row: {
          change_summary: string | null
          content: Json
          content_text: string | null
          created_at: string
          id: string
          note_id: string
          title: string
          user_id: string
          version_number: number
        }
        Insert: {
          change_summary?: string | null
          content: Json
          content_text?: string | null
          created_at?: string
          id?: string
          note_id: string
          title: string
          user_id: string
          version_number: number
        }
        Update: {
          change_summary?: string | null
          content?: Json
          content_text?: string | null
          created_at?: string
          id?: string
          note_id?: string
          title?: string
          user_id?: string
          version_number?: number
        }
        Relationships: [
          {
            foreignKeyName: "note_versions_note_id_fkey"
            columns: ["note_id"]
            isOneToOne: false
            referencedRelation: "notes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "note_versions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      notes: {
        Row: {
          content: Json
          content_text: string | null
          created_at: string
          folder_path: string | null
          id: string
          is_archived: boolean | null
          is_pinned: boolean | null
          project_id: string | null
          tags: string[] | null
          title: string
          updated_at: string
          user_id: string
          version_number: number | null
          word_count: number | null
        }
        Insert: {
          content?: Json
          content_text?: string | null
          created_at?: string
          folder_path?: string | null
          id?: string
          is_archived?: boolean | null
          is_pinned?: boolean | null
          project_id?: string | null
          tags?: string[] | null
          title?: string
          updated_at?: string
          user_id: string
          version_number?: number | null
          word_count?: number | null
        }
        Update: {
          content?: Json
          content_text?: string | null
          created_at?: string
          folder_path?: string | null
          id?: string
          is_archived?: boolean | null
          is_pinned?: boolean | null
          project_id?: string | null
          tags?: string[] | null
          title?: string
          updated_at?: string
          user_id?: string
          version_number?: number | null
          word_count?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "notes_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notes_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          action_url: string | null
          body: string | null
          created_at: string
          id: string
          is_read: boolean | null
          metadata: Json | null
          push_sent: boolean | null
          push_sent_at: string | null
          read_at: string | null
          source_id: string | null
          source_type: string | null
          title: string
          type: Database["public"]["Enums"]["notification_type"]
          user_id: string
        }
        Insert: {
          action_url?: string | null
          body?: string | null
          created_at?: string
          id?: string
          is_read?: boolean | null
          metadata?: Json | null
          push_sent?: boolean | null
          push_sent_at?: string | null
          read_at?: string | null
          source_id?: string | null
          source_type?: string | null
          title: string
          type: Database["public"]["Enums"]["notification_type"]
          user_id: string
        }
        Update: {
          action_url?: string | null
          body?: string | null
          created_at?: string
          id?: string
          is_read?: boolean | null
          metadata?: Json | null
          push_sent?: boolean | null
          push_sent_at?: string | null
          read_at?: string | null
          source_id?: string | null
          source_type?: string | null
          title?: string
          type?: Database["public"]["Enums"]["notification_type"]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notifications_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      projects: {
        Row: {
          created_at: string
          description: string | null
          github_default_branch: string | null
          github_url: string | null
          id: string
          is_git_linked: boolean | null
          last_opened_at: string | null
          name: string
          settings: Json | null
          slug: string | null
          updated_at: string
          user_id: string
          workspace_path: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          github_default_branch?: string | null
          github_url?: string | null
          id?: string
          is_git_linked?: boolean | null
          last_opened_at?: string | null
          name: string
          settings?: Json | null
          slug?: string | null
          updated_at?: string
          user_id: string
          workspace_path: string
        }
        Update: {
          created_at?: string
          description?: string | null
          github_default_branch?: string | null
          github_url?: string | null
          id?: string
          is_git_linked?: boolean | null
          last_opened_at?: string | null
          name?: string
          settings?: Json | null
          slug?: string | null
          updated_at?: string
          user_id?: string
          workspace_path?: string
        }
        Relationships: [
          {
            foreignKeyName: "projects_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      push_subscriptions: {
        Row: {
          auth: string
          created_at: string
          endpoint: string
          id: string
          p256dh: string
          user_agent: string | null
          user_id: string
        }
        Insert: {
          auth: string
          created_at?: string
          endpoint: string
          id?: string
          p256dh: string
          user_agent?: string | null
          user_id: string
        }
        Update: {
          auth?: string
          created_at?: string
          endpoint?: string
          id?: string
          p256dh?: string
          user_agent?: string | null
          user_id?: string
        }
        Relationships: []
      }
      rate_limit_buckets: {
        Row: {
          bucket_key: string
          id: string
          last_refill: string
          max_tokens: number
          refill_rate: number
          tokens: number
          user_id: string
        }
        Insert: {
          bucket_key: string
          id?: string
          last_refill?: string
          max_tokens?: number
          refill_rate?: number
          tokens?: number
          user_id: string
        }
        Update: {
          bucket_key?: string
          id?: string
          last_refill?: string
          max_tokens?: number
          refill_rate?: number
          tokens?: number
          user_id?: string
        }
        Relationships: []
      }
      reminders: {
        Row: {
          body: string | null
          created_at: string
          id: string
          next_occurrence: string | null
          note_id: string | null
          recurrence_rule: string | null
          remind_at: string
          snooze_count: number | null
          snoozed_until: string | null
          status: Database["public"]["Enums"]["reminder_status"] | null
          task_id: string | null
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          body?: string | null
          created_at?: string
          id?: string
          next_occurrence?: string | null
          note_id?: string | null
          recurrence_rule?: string | null
          remind_at: string
          snooze_count?: number | null
          snoozed_until?: string | null
          status?: Database["public"]["Enums"]["reminder_status"] | null
          task_id?: string | null
          title: string
          updated_at?: string
          user_id: string
        }
        Update: {
          body?: string | null
          created_at?: string
          id?: string
          next_occurrence?: string | null
          note_id?: string | null
          recurrence_rule?: string | null
          remind_at?: string
          snooze_count?: number | null
          snoozed_until?: string | null
          status?: Database["public"]["Enums"]["reminder_status"] | null
          task_id?: string | null
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "reminders_note_id_fkey"
            columns: ["note_id"]
            isOneToOne: false
            referencedRelation: "notes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reminders_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reminders_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      room_members: {
        Row: {
          joined_at: string
          room_id: string
          user_id: string
        }
        Insert: {
          joined_at?: string
          room_id: string
          user_id: string
        }
        Update: {
          joined_at?: string
          room_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "room_members_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "rooms"
            referencedColumns: ["id"]
          },
        ]
      }
      rooms: {
        Row: {
          created_at: string
          id: string
          name: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
        }
        Relationships: []
      }
      semantic_memory: {
        Row: {
          content: string
          created_at: string
          embedding: string
          expires_at: string | null
          id: string
          importance: number | null
          memory_type: Database["public"]["Enums"]["memory_type"]
          metadata: Json | null
          project_id: string | null
          source_id: string | null
          source_type: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          content: string
          created_at?: string
          embedding: string
          expires_at?: string | null
          id?: string
          importance?: number | null
          memory_type: Database["public"]["Enums"]["memory_type"]
          metadata?: Json | null
          project_id?: string | null
          source_id?: string | null
          source_type?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          content?: string
          created_at?: string
          embedding?: string
          expires_at?: string | null
          id?: string
          importance?: number | null
          memory_type?: Database["public"]["Enums"]["memory_type"]
          metadata?: Json | null
          project_id?: string | null
          source_id?: string | null
          source_type?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "semantic_memory_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "semantic_memory_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      tasks: {
        Row: {
          completed_at: string | null
          created_at: string
          description: string | null
          due_date: string | null
          due_time: string | null
          id: string
          metadata: Json | null
          priority: Database["public"]["Enums"]["task_priority"] | null
          project_id: string | null
          recurrence_rule: string | null
          reminder_at: string | null
          section: string | null
          sort_order: number | null
          status: Database["public"]["Enums"]["task_status"] | null
          tags: string[] | null
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          description?: string | null
          due_date?: string | null
          due_time?: string | null
          id?: string
          metadata?: Json | null
          priority?: Database["public"]["Enums"]["task_priority"] | null
          project_id?: string | null
          recurrence_rule?: string | null
          reminder_at?: string | null
          section?: string | null
          sort_order?: number | null
          status?: Database["public"]["Enums"]["task_status"] | null
          tags?: string[] | null
          title: string
          updated_at?: string
          user_id: string
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          description?: string | null
          due_date?: string | null
          due_time?: string | null
          id?: string
          metadata?: Json | null
          priority?: Database["public"]["Enums"]["task_priority"] | null
          project_id?: string | null
          recurrence_rule?: string | null
          reminder_at?: string | null
          section?: string | null
          sort_order?: number | null
          status?: Database["public"]["Enums"]["task_status"] | null
          tags?: string[] | null
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tasks_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      usage_stats: {
        Row: {
          api_calls: number
          created_at: string
          id: string
          input_tokens: number
          output_tokens: number
          rate_limit_hits: number
          session_count: number
          stat_date: string
          tool_calls: number
          total_session_time_seconds: number
          total_tokens: number
          updated_at: string
          user_id: string
        }
        Insert: {
          api_calls?: number
          created_at?: string
          id?: string
          input_tokens?: number
          output_tokens?: number
          rate_limit_hits?: number
          session_count?: number
          stat_date?: string
          tool_calls?: number
          total_session_time_seconds?: number
          total_tokens?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          api_calls?: number
          created_at?: string
          id?: string
          input_tokens?: number
          output_tokens?: number
          rate_limit_hits?: number
          session_count?: number
          stat_date?: string
          tool_calls?: number
          total_session_time_seconds?: number
          total_tokens?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      user_settings: {
        Row: {
          active_conversation_id: string | null
          active_note_id: string | null
          active_tab: string | null
          ai_personality: string | null
          ai_proactivity: boolean | null
          analytics_enabled: boolean | null
          created_at: string
          date_format: string | null
          email_notifications: boolean | null
          extended_thinking: boolean | null
          features: Json | null
          id: string
          language: string | null
          max_output_tokens: number | null
          model_id: string | null
          notes_tag_filter: string | null
          notifications_enabled: boolean | null
          push_notifications: boolean | null
          task_sidebar_filter: string | null
          theme: string | null
          time_format: string | null
          timezone: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          active_conversation_id?: string | null
          active_note_id?: string | null
          active_tab?: string | null
          ai_personality?: string | null
          ai_proactivity?: boolean | null
          analytics_enabled?: boolean | null
          created_at?: string
          date_format?: string | null
          email_notifications?: boolean | null
          extended_thinking?: boolean | null
          features?: Json | null
          id?: string
          language?: string | null
          max_output_tokens?: number | null
          model_id?: string | null
          notes_tag_filter?: string | null
          notifications_enabled?: boolean | null
          push_notifications?: boolean | null
          task_sidebar_filter?: string | null
          theme?: string | null
          time_format?: string | null
          timezone?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          active_conversation_id?: string | null
          active_note_id?: string | null
          active_tab?: string | null
          ai_personality?: string | null
          ai_proactivity?: boolean | null
          analytics_enabled?: boolean | null
          created_at?: string
          date_format?: string | null
          email_notifications?: boolean | null
          extended_thinking?: boolean | null
          features?: Json | null
          id?: string
          language?: string | null
          max_output_tokens?: number | null
          model_id?: string | null
          notes_tag_filter?: string | null
          notifications_enabled?: boolean | null
          push_notifications?: boolean | null
          task_sidebar_filter?: string | null
          theme?: string | null
          time_format?: string | null
          timezone?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_settings_active_conversation_id_fkey"
            columns: ["active_conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_settings_active_note_id_fkey"
            columns: ["active_note_id"]
            isOneToOne: false
            referencedRelation: "notes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_settings_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      users: {
        Row: {
          avatar_url: string | null
          created_at: string
          email: string
          full_name: string | null
          id: string
          timezone: string | null
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          email: string
          full_name?: string | null
          id: string
          timezone?: string | null
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          email?: string
          full_name?: string | null
          id?: string
          timezone?: string | null
          updated_at?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      consume_rate_limit_token:
        | {
            Args: { p_bucket_key: string; p_tokens_to_consume?: number }
            Returns: boolean
          }
        | {
            Args: {
              p_bucket_key: string
              p_tokens_to_consume?: number
              p_user_id?: string
            }
            Returns: boolean
          }
      get_or_create_user_settings: {
        Args: { p_user_id: string }
        Returns: {
          active_conversation_id: string | null
          active_note_id: string | null
          active_tab: string | null
          ai_personality: string | null
          ai_proactivity: boolean | null
          analytics_enabled: boolean | null
          created_at: string
          date_format: string | null
          email_notifications: boolean | null
          extended_thinking: boolean | null
          features: Json | null
          id: string
          language: string | null
          max_output_tokens: number | null
          model_id: string | null
          notes_tag_filter: string | null
          notifications_enabled: boolean | null
          push_notifications: boolean | null
          task_sidebar_filter: string | null
          theme: string | null
          time_format: string | null
          timezone: string | null
          updated_at: string
          user_id: string
        }[]
        SetofOptions: {
          from: "*"
          to: "user_settings"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      increment_message_count: {
        Args: {
          p_conversation_id: string
          p_count?: number
        }
        Returns: undefined
      }
      increment_usage_stats: {
        Args: {
          p_api_calls?: number
          p_input_tokens?: number
          p_output_tokens?: number
          p_session_time_seconds?: number
          p_user_id?: string
        }
        Returns: undefined
      }
      match_memories:
        | {
            Args: {
              match_count?: number
              match_threshold?: number
              p_user_id?: string
              query_embedding: string
            }
            Returns: {
              content: string
              created_at: string
              id: string
              memory_type: string
              metadata: Json
              similarity: number
            }[]
          }
        | {
            Args: {
              match_count?: number
              match_threshold?: number
              p_project_id?: string
              p_user_id?: string
              query_embedding: string
            }
            Returns: {
              content: string
              created_at: string
              id: string
              memory_type: string
              metadata: Json
              similarity: number
            }[]
          }
      search_embeddings:
        | {
            Args: {
              filter_content_type?: string
              filter_user_id?: string
              match_count?: number
              match_threshold?: number
              query_embedding: string
            }
            Returns: {
              content: string
              content_type: string
              id: string
              meta: Json
              similarity: number
              source_id: string
              source_table: string
            }[]
          }
        | {
            Args: {
              filter_content_type?: string
              filter_project_id?: string
              filter_user_id?: string
              match_count?: number
              match_threshold?: number
              query_embedding: string
            }
            Returns: {
              content: string
              content_type: string
              id: string
              meta: Json
              similarity: number
              source_id: string
              source_table: string
            }[]
          }
    }
    Enums: {
      conversation_status: "active" | "archived" | "deleted"
      memory_type: "fact" | "conversation" | "task" | "project" | "preference"
      message_role: "user" | "assistant" | "system" | "tool"
      notification_type:
        | "reminder"
        | "task_due"
        | "mention"
        | "system"
        | "achievement"
      reminder_status: "pending" | "sent" | "dismissed" | "snoozed"
      task_priority: "low" | "medium" | "high" | "urgent"
      task_status: "pending" | "in_progress" | "completed" | "cancelled"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      conversation_status: ["active", "archived", "deleted"],
      memory_type: ["fact", "conversation", "task", "project", "preference"],
      message_role: ["user", "assistant", "system", "tool"],
      notification_type: [
        "reminder",
        "task_due",
        "mention",
        "system",
        "achievement",
      ],
      reminder_status: ["pending", "sent", "dismissed", "snoozed"],
      task_priority: ["low", "medium", "high", "urgent"],
      task_status: ["pending", "in_progress", "completed", "cancelled"],
    },
  },
} as const
