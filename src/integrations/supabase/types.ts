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
    PostgrestVersion: "14.17"
  }
  public: {
    Tables: {
      admin_audit: {
        Row: {
          action: string
          actor_user_id: string
          created_at: string
          details: Json | null
          id: string
          order_id: string | null
        }
        Insert: {
          action: string
          actor_user_id: string
          created_at?: string
          details?: Json | null
          id?: string
          order_id?: string | null
        }
        Update: {
          action?: string
          actor_user_id?: string
          created_at?: string
          details?: Json | null
          id?: string
          order_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "admin_audit_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      app_settings: {
        Row: {
          expiry_minutes: number
          id: number
          low_isk_threshold: number
          low_wisk_threshold: number
          max_usd: number
          min_usd: number
          notify_min_usd_created: number
          paused: boolean
          paused_reason: string | null
          payouts_frozen: boolean
          payouts_frozen_reason: string | null
          premium_bps: number
          telegram_chat_id: string | null
          unwrap_fee_bps: number
          updated_at: string
          updated_by: string | null
          wrap_fee_bps: number
        }
        Insert: {
          expiry_minutes?: number
          id?: number
          low_isk_threshold?: number
          low_wisk_threshold?: number
          max_usd?: number
          min_usd?: number
          notify_min_usd_created?: number
          paused?: boolean
          paused_reason?: string | null
          payouts_frozen?: boolean
          payouts_frozen_reason?: string | null
          premium_bps?: number
          telegram_chat_id?: string | null
          unwrap_fee_bps?: number
          updated_at?: string
          updated_by?: string | null
          wrap_fee_bps?: number
        }
        Update: {
          expiry_minutes?: number
          id?: number
          low_isk_threshold?: number
          low_wisk_threshold?: number
          max_usd?: number
          min_usd?: number
          notify_min_usd_created?: number
          paused?: boolean
          paused_reason?: string | null
          payouts_frozen?: boolean
          payouts_frozen_reason?: string | null
          premium_bps?: number
          telegram_chat_id?: string | null
          unwrap_fee_bps?: number
          updated_at?: string
          updated_by?: string | null
          wrap_fee_bps?: number
        }
        Relationships: []
      }
      blocked_addresses: {
        Row: {
          address: string
          created_at: string
          created_by: string | null
          id: string
          notes: string | null
          reason: string | null
        }
        Insert: {
          address: string
          created_at?: string
          created_by?: string | null
          id?: string
          notes?: string | null
          reason?: string | null
        }
        Update: {
          address?: string
          created_at?: string
          created_by?: string | null
          id?: string
          notes?: string | null
          reason?: string | null
        }
        Relationships: []
      }
      custom_tokens: {
        Row: {
          address: string
          bitmart_symbol: string | null
          chain: string
          created_at: string
          created_by: string | null
          decimals: number
          enabled: boolean
          id: string
          is_native: boolean
          symbol: string
          updated_at: string
        }
        Insert: {
          address: string
          bitmart_symbol?: string | null
          chain: string
          created_at?: string
          created_by?: string | null
          decimals: number
          enabled?: boolean
          id?: string
          is_native?: boolean
          symbol: string
          updated_at?: string
        }
        Update: {
          address?: string
          bitmart_symbol?: string | null
          chain?: string
          created_at?: string
          created_by?: string | null
          decimals?: number
          enabled?: boolean
          id?: string
          is_native?: boolean
          symbol?: string
          updated_at?: string
        }
        Relationships: []
      }
      deposits: {
        Row: {
          amount_source: number | null
          amount_usd: number
          block_number: number
          chain: string
          confirmations: number
          detected_at: string
          from_address: string
          id: string
          log_index: number
          order_id: string | null
          to_address: string
          token: string
          tx_hash: string
        }
        Insert: {
          amount_source?: number | null
          amount_usd: number
          block_number: number
          chain: string
          confirmations?: number
          detected_at?: string
          from_address: string
          id?: string
          log_index?: number
          order_id?: string | null
          to_address: string
          token: string
          tx_hash: string
        }
        Update: {
          amount_source?: number | null
          amount_usd?: number
          block_number?: number
          chain?: string
          confirmations?: number
          detected_at?: string
          from_address?: string
          id?: string
          log_index?: number
          order_id?: string | null
          to_address?: string
          token?: string
          tx_hash?: string
        }
        Relationships: [
          {
            foreignKeyName: "deposits_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      email_send_log: {
        Row: {
          created_at: string
          error_message: string | null
          id: string
          message_id: string | null
          metadata: Json | null
          recipient_email: string
          status: string
          template_name: string
        }
        Insert: {
          created_at?: string
          error_message?: string | null
          id?: string
          message_id?: string | null
          metadata?: Json | null
          recipient_email: string
          status: string
          template_name: string
        }
        Update: {
          created_at?: string
          error_message?: string | null
          id?: string
          message_id?: string | null
          metadata?: Json | null
          recipient_email?: string
          status?: string
          template_name?: string
        }
        Relationships: []
      }
      email_send_state: {
        Row: {
          auth_email_ttl_minutes: number
          batch_size: number
          id: number
          retry_after_until: string | null
          send_delay_ms: number
          transactional_email_ttl_minutes: number
          updated_at: string
        }
        Insert: {
          auth_email_ttl_minutes?: number
          batch_size?: number
          id?: number
          retry_after_until?: string | null
          send_delay_ms?: number
          transactional_email_ttl_minutes?: number
          updated_at?: string
        }
        Update: {
          auth_email_ttl_minutes?: number
          batch_size?: number
          id?: number
          retry_after_until?: string | null
          send_delay_ms?: number
          transactional_email_ttl_minutes?: number
          updated_at?: string
        }
        Relationships: []
      }
      email_unsubscribe_tokens: {
        Row: {
          created_at: string
          email: string
          id: string
          token: string
          used_at: string | null
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          token: string
          used_at?: string | null
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          token?: string
          used_at?: string | null
        }
        Relationships: []
      }
      hd_address_counter: {
        Row: {
          id: number
          next_index: number
          updated_at: string
        }
        Insert: {
          id?: number
          next_index?: number
          updated_at?: string
        }
        Update: {
          id?: number
          next_index?: number
          updated_at?: string
        }
        Relationships: []
      }
      hot_wallet_locks: {
        Row: {
          locked_by: string | null
          locked_until: string
          updated_at: string
          wallet_key: string
        }
        Insert: {
          locked_by?: string | null
          locked_until?: string
          updated_at?: string
          wallet_key: string
        }
        Update: {
          locked_by?: string | null
          locked_until?: string
          updated_at?: string
          wallet_key?: string
        }
        Relationships: []
      }
      order_events: {
        Row: {
          created_at: string
          details: Json | null
          event: string
          id: string
          kind: string
          order_id: string
        }
        Insert: {
          created_at?: string
          details?: Json | null
          event: string
          id?: string
          kind: string
          order_id: string
        }
        Update: {
          created_at?: string
          details?: Json | null
          event?: string
          id?: string
          kind?: string
          order_id?: string
        }
        Relationships: []
      }
      orders: {
        Row: {
          bitmart_avg_price: number | null
          bitmart_filled_dest: number | null
          bitmart_order_id: string | null
          bitmart_spot_price: number
          created_at: string
          deposit_address: string
          deposit_index: number
          deposit_start_block: number | null
          dest_address: string
          dest_asset: string
          dest_broadcast_nonce: number | null
          dest_fee_sats: number | null
          dest_from_address: string | null
          dest_tx_hash: string | null
          error_message: string | null
          expires_at: string
          id: string
          original_quoted_dest_out: number | null
          paid_amount_usd: number | null
          paid_tx_hash: string | null
          premium_bps: number
          public_id: string
          quoted_dest_out: number
          quoted_dest_per_usd: number
          send_attempts: number
          source_amount_usd: number
          source_chain: string
          source_token: string
          status: Database["public"]["Enums"]["order_status"]
          stuck_notified_at: string | null
          underpayment_ack: string | null
          updated_at: string
          withdrawal_id: string | null
        }
        Insert: {
          bitmart_avg_price?: number | null
          bitmart_filled_dest?: number | null
          bitmart_order_id?: string | null
          bitmart_spot_price: number
          created_at?: string
          deposit_address: string
          deposit_index: number
          deposit_start_block?: number | null
          dest_address: string
          dest_asset?: string
          dest_broadcast_nonce?: number | null
          dest_fee_sats?: number | null
          dest_from_address?: string | null
          dest_tx_hash?: string | null
          error_message?: string | null
          expires_at?: string
          id?: string
          original_quoted_dest_out?: number | null
          paid_amount_usd?: number | null
          paid_tx_hash?: string | null
          premium_bps?: number
          public_id?: string
          quoted_dest_out: number
          quoted_dest_per_usd: number
          send_attempts?: number
          source_amount_usd: number
          source_chain: string
          source_token: string
          status?: Database["public"]["Enums"]["order_status"]
          stuck_notified_at?: string | null
          underpayment_ack?: string | null
          updated_at?: string
          withdrawal_id?: string | null
        }
        Update: {
          bitmart_avg_price?: number | null
          bitmart_filled_dest?: number | null
          bitmart_order_id?: string | null
          bitmart_spot_price?: number
          created_at?: string
          deposit_address?: string
          deposit_index?: number
          deposit_start_block?: number | null
          dest_address?: string
          dest_asset?: string
          dest_broadcast_nonce?: number | null
          dest_fee_sats?: number | null
          dest_from_address?: string | null
          dest_tx_hash?: string | null
          error_message?: string | null
          expires_at?: string
          id?: string
          original_quoted_dest_out?: number | null
          paid_amount_usd?: number | null
          paid_tx_hash?: string | null
          premium_bps?: number
          public_id?: string
          quoted_dest_out?: number
          quoted_dest_per_usd?: number
          send_attempts?: number
          source_amount_usd?: number
          source_chain?: string
          source_token?: string
          status?: Database["public"]["Enums"]["order_status"]
          stuck_notified_at?: string | null
          underpayment_ack?: string | null
          updated_at?: string
          withdrawal_id?: string | null
        }
        Relationships: []
      }
      suppressed_emails: {
        Row: {
          created_at: string
          email: string
          id: string
          metadata: Json | null
          reason: string
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          metadata?: Json | null
          reason: string
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          metadata?: Json | null
          reason?: string
        }
        Relationships: []
      }
      isk_balance_snapshots: {
        Row: {
          balance_isk: number
          id: number
          taken_at: string
        }
        Insert: {
          balance_isk: number
          id?: number
          taken_at?: string
        }
        Update: {
          balance_isk?: number
          id?: number
          taken_at?: string
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
      allocate_hd_index: { Args: { _recycle?: boolean }; Returns: number }
      delete_email: {
        Args: { message_id: number; queue_name: string }
        Returns: boolean
      }
      email_queue_dispatch: { Args: never; Returns: undefined }
      enqueue_email: {
        Args: { payload: Json; queue_name: string }
        Returns: number
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      move_to_dlq: {
        Args: {
          dlq_name: string
          message_id: number
          payload: Json
          source_queue: string
        }
        Returns: number
      }
      next_hd_index: { Args: never; Returns: number }
      read_email_batch: {
        Args: { batch_size: number; queue_name: string; vt: number }
        Returns: {
          message: Json
          msg_id: number
          read_ct: number
        }[]
      }
      release_wallet_lock: {
        Args: { _holder: string; _wallet_key: string }
        Returns: undefined
      }
      try_acquire_wallet_lock: {
        Args: { _holder: string; _ttl_seconds: number; _wallet_key: string }
        Returns: boolean
      }
    }
    Enums: {
      app_role: "admin"
      order_status:
        | "awaiting_payment"
        | "payment_detected"
        | "confirmed"
        | "buying_on_bitmart"
        | "bought"
        | "withdrawing"
        | "completed"
        | "expired"
        | "failed"
        | "refunded"
        | "sending"
        | "canceled"
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
      app_role: ["admin"],
      order_status: [
        "awaiting_payment",
        "payment_detected",
        "confirmed",
        "buying_on_bitmart",
        "bought",
        "withdrawing",
        "completed",
        "expired",
        "failed",
        "refunded",
        "sending",
        "canceled",
      ],
    },
  },
} as const
