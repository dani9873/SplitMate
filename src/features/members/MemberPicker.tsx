import { Check } from 'lucide-react-native';
import { ScrollView, Pressable } from 'react-native';

import { cn, MemberAvatar, Sheet, Text, useAppTheme } from '@/ui';

export interface PickableMember {
  readonly id: string;
  /** Nombre visible, ya con "(tú)" si corresponde. */
  readonly label: string;
  readonly isMe: boolean;
}

export interface MemberPickerProps {
  visible: boolean;
  title: string;
  members: readonly PickableMember[];
  value: string | null;
  onChange: (memberId: string) => void;
  onClose: () => void;
}

/** Hoja para elegir a un miembro: quién pagó, quién recibe una transferencia. */
export function MemberPicker({
  visible,
  title,
  members,
  value,
  onChange,
  onClose,
}: MemberPickerProps) {
  const { colors } = useAppTheme();
  return (
    <Sheet visible={visible} onClose={onClose} title={title} testID="member-picker">
      <ScrollView accessibilityRole="radiogroup" contentContainerClassName="pb-2">
        {members.map((member, index) => {
          const selected = member.id === value;
          return (
            <Pressable
              key={member.id}
              testID={`member-option-${index}`}
              accessibilityRole="radio"
              accessibilityLabel={member.label}
              accessibilityState={{ checked: selected }}
              onPress={() => {
                onChange(member.id);
                onClose();
              }}
              className={cn(
                'min-h-[56px] flex-row items-center gap-3 px-5',
                selected ? 'bg-primary-soft' : 'active:bg-surface-muted',
              )}
            >
              <MemberAvatar name={member.label} highlight={member.isMe} />
              <Text className="flex-1" numberOfLines={1}>
                {member.label}
              </Text>
              {selected ? <Check size={20} color={colors.primary} strokeWidth={2.6} /> : null}
            </Pressable>
          );
        })}
      </ScrollView>
    </Sheet>
  );
}
