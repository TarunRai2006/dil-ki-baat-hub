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
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      chat_messages: {
        Row: {
          client_msg_id: string | null
          created_at: string
          expires_at: string | null
          id: string
          is_hidden: boolean
          message: string
          room_id: string
          seq: number
          sender_type: string
        }
        Insert: {
          client_msg_id?: string | null
          created_at?: string
          expires_at?: string | null
          id?: string
          is_hidden?: boolean
          message: string
          room_id: string
          seq?: never
          sender_type?: string
        }
        Update: {
          client_msg_id?: string | null
          created_at?: string
          expires_at?: string | null
          id?: string
          is_hidden?: boolean
          message?: string
          room_id?: string
          seq?: never
          sender_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "chat_messages_room_fk"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "chat_rooms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chat_messages_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "submissions"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_rooms: {
        Row: {
          created_at: string
          expires_at: string | null
          id: string
          last_message_at: string | null
          status: string
          token_hash: string | null
        }
        Insert: {
          created_at?: string
          expires_at?: string | null
          id: string
          last_message_at?: string | null
          status?: string
          token_hash?: string | null
        }
        Update: {
          created_at?: string
          expires_at?: string | null
          id?: string
          last_message_at?: string | null
          status?: string
          token_hash?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "chat_rooms_id_fkey"
            columns: ["id"]
            isOneToOne: true
            referencedRelation: "submissions"
            referencedColumns: ["id"]
          },
        ]
      }
      moderation_log: {
        Row: {
          action: string
          actor_id: string | null
          created_at: string
          detail: Json
          id: number
          submission_id: string
        }
        Insert: {
          action: string
          actor_id?: string | null
          created_at?: string
          detail?: Json
          id?: never
          submission_id: string
        }
        Update: {
          action?: string
          actor_id?: string | null
          created_at?: string
          detail?: Json
          id?: never
          submission_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "moderation_log_submission_id_fkey"
            columns: ["submission_id"]
            isOneToOne: false
            referencedRelation: "submissions"
            referencedColumns: ["id"]
          },
        ]
      }
      submissions: {
        Row: {
          admin_notes: string | null
          alias: string
          anon_user_id: string | null
          category: string
          chat_enabled: boolean
          chat_ttl: string
          client_request_id: string | null
          community_question: string | null
          content: string
          created_at: string
          deleted_at: string | null
          emotional_state: number
          highlight_on_instagram: string
          id: string
          intent: string
          is_archived: boolean
          is_featured: boolean
          nickname: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          search_text: string | null
          status: string
          updated_at: string
        }
        Insert: {
          admin_notes?: string | null
          alias?: string
          anon_user_id?: string | null
          category?: string
          chat_enabled?: boolean
          chat_ttl?: string
          client_request_id?: string | null
          community_question?: string | null
          content: string
          created_at?: string
          deleted_at?: string | null
          emotional_state?: number
          highlight_on_instagram?: string
          id?: string
          intent?: string
          is_archived?: boolean
          is_featured?: boolean
          nickname?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          admin_notes?: string | null
          alias?: string
          anon_user_id?: string | null
          category?: string
          chat_enabled?: boolean
          chat_ttl?: string
          client_request_id?: string | null
          community_question?: string | null
          content?: string
          created_at?: string
          deleted_at?: string | null
          emotional_state?: number
          highlight_on_instagram?: string
          id?: string
          intent?: string
          is_archived?: boolean
          is_featured?: boolean
          nickname?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      admin_dashboard_stats: { Args: never; Returns: Json }
      admin_send_chat_message: {
        Args: { _client_msg_id: string | null; _message: string; _room_id: string }
        Returns: Database["public"]["Tables"]["chat_messages"]["Row"]
      }
      admin_set_message_hidden: {
        Args: { _hidden: boolean; _message_id: string }
        Returns: Database["public"]["Tables"]["chat_messages"]["Row"]
      }
      admin_set_room_status: {
        Args: { _room_id: string; _status: string }
        Returns: Database["public"]["Tables"]["chat_rooms"]["Row"]
      }
      admin_update_submission: {
        Args: {
          _admin_notes?: string
          _deleted?: boolean
          _id: string
          _is_archived?: boolean
          _is_featured?: boolean
          _status?: string
        }
        Returns: Database["public"]["Tables"]["submissions"]["Row"]
      }
      get_chat_room: {
        Args: { _room_id: string; _token: string }
        Returns: {
          alias: string
          expires_at: string | null
          room_id: string
          status: string
          topic: string
        }[]
      }
      get_room_messages: {
        Args: { _after?: string; _room_id: string; _token: string }
        Returns: {
          client_msg_id: string | null
          created_at: string
          id: string
          message: string
          sender_type: string
        }[]
      }
      get_public_whispers: {
        Args: { _limit?: number }
        Returns: { excerpt: string }[]
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_admin: { Args: never; Returns: boolean }
      send_chat_message: {
        Args: { _client_msg_id: string; _message: string; _room_id: string; _token: string }
        Returns: {
          client_msg_id: string | null
          created_at: string
          id: string
          message: string
          sender_type: string
        }[]
      }
      submit_confession: {
        Args: {
          _anon_user_id: string
          _category: string
          _chat_enabled: boolean
          _chat_ttl: string
          _client_request_id: string
          _community_question: string
          _content: string
          _emotional_state: number
          _highlight_on_instagram: string
          _intent: string
          _nickname: string
        }
        Returns: {
          alias: string
          room_expires_at: string | null
          room_id: string | null
          room_token: string | null
          submission_id: string
        }[]
      }
    }
    Enums: {
      app_role: "admin" | "moderator" | "user"
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
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
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
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
      app_role: ["admin", "moderator", "user"],
    },
  },
} as const
